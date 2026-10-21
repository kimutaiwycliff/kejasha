import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  parseBusinessCsv,
  parseMpesaSms,
  parseNairobiDateTime,
  parseStatementPdf,
  splitParty,
} from './parsers';

describe('helpers', () => {
  it('reads Nairobi times in the formats statements use', () => {
    expect(parseNairobiDateTime('2026-10-21 10:15:30').toISOString()).toBe(
      '2026-10-21T07:15:30.000Z',
    );
    expect(parseNairobiDateTime('21-10-2026 10:15:30').toISOString()).toBe(
      '2026-10-21T07:15:30.000Z',
    );
    expect(parseNairobiDateTime('1/2/2026 9:05').toISOString()).toBe('2026-02-01T06:05:00.000Z');
    expect(() => parseNairobiDateTime('yesterday')).toThrow();
  });
  it('splits party info into phone and name', () => {
    expect(splitParty('254712000111 - JANE WANJIRU')).toEqual({
      msisdn: '+254712000111',
      payerName: 'JANE WANJIRU',
    });
    expect(splitParty('Funds received from - 0712***111 JANE WANJIRU')).toEqual({
      msisdn: '0712***111',
      payerName: 'JANE WANJIRU',
    });
    expect(splitParty('JOHN')).toEqual({ msisdn: null, payerName: 'JOHN' });
  });
});

describe('business CSV', () => {
  const csv = [
    'Organization Name,KEJASHA TEST LTD',
    'Time Period,01-10-2026 - 31-10-2026',
    '',
    '"Receipt No.","Completion Time","Initiation Time","Details","Transaction Status","Paid In","Withdrawn","Balance","Balance Confirmed","Reason Type","Other Party Info","Linked Transaction ID","A/C No."',
    '"RKT1AAAAAA","21-10-2026 10:15:30","21-10-2026 10:15:30","Pay Bill from 254712000111 - JANE WANJIRU Acc. A1","Completed","30,000.00","","45,000.00","true","Pay Bill Online","254712000111 - JANE WANJIRU","","A1"',
    '"RKT1BBBBBB","21-10-2026 11:00:00","21-10-2026 11:00:00","Business Payment to Bank","Completed","","-10,000.00","35,000.00","true","Business Pay Bill","Equity Bank","",""',
    '"RKT1CCCCCC","22-10-2026 08:00:00","22-10-2026 08:00:00","Pay Bill from 254722000222 - BRIAN","Failed","5,000.00","","35,000.00","true","Pay Bill Online","254722000222 - BRIAN","","B2"',
    '"RKT1DDDDDD","22-10-2026 09:30:00","22-10-2026 09:30:00","Pay Bill from 254733000333 - AMINA, ODHIAMBO","Completed","12,500.50","","47,500.50","true","Pay Bill Online","254733000333 - AMINA, ODHIAMBO","","rent"',
  ].join('\r\n');

  it('keeps completed credits only and reads every field', () => {
    const { rows, total } = parseBusinessCsv(csv);
    expect(total).toBe(4);
    expect(rows).toEqual([
      {
        providerRef: 'RKT1AAAAAA',
        paidAt: new Date('2026-10-21T07:15:30Z'),
        amountCents: 3_000_000n,
        msisdn: '+254712000111',
        payerName: 'JANE WANJIRU',
        accountRef: 'A1',
      },
      {
        providerRef: 'RKT1DDDDDD',
        paidAt: new Date('2026-10-22T06:30:00Z'),
        amountCents: 1_250_050n,
        msisdn: '+254733000333',
        payerName: 'AMINA, ODHIAMBO',
        accountRef: 'rent',
      },
    ]);
  });

  it('refuses files that are not M-Pesa statements', () => {
    expect(() => parseBusinessCsv('name,amount\nx,1')).toThrow(/Receipt No/);
  });
});

describe('statement PDF', () => {
  async function pdf(lines: string[]) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    lines.forEach((l, i) => page.drawText(l, { x: 30, y: 560 - i * 18, size: 8, font }));
    return doc.save();
  }

  it('extracts credit rows and skips debits and headers', async () => {
    const bytes = await pdf([
      'M-PESA STATEMENT',
      'Receipt No. Completion Time Details Transaction Status Paid In Withdrawn Balance',
      'QKA1B2C3D4 2026-10-21 10:15:30 Funds received from - 0712***111 JANE WANJIRU Completed 30,000.00 0.00 45,000.00',
      'QKA1B2C3D5 2026-10-21 12:00:00 Customer Transfer to - 0722***222 BRIAN Completed 0.00 -1,000.00 44,000.00',
    ]);
    const { rows, total } = await parseStatementPdf(bytes);
    expect(total).toBe(2);
    expect(rows).toEqual([
      {
        providerRef: 'QKA1B2C3D4',
        paidAt: new Date('2026-10-21T07:15:30Z'),
        amountCents: 3_000_000n,
        msisdn: '0712***111',
        payerName: 'JANE WANJIRU',
        accountRef: null,
      },
    ]);
  });

  it('reports unreadable files', async () => {
    await expect(parseStatementPdf(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'unrecognised_statement',
    });
  });
});

describe('M-Pesa SMS', () => {
  it('parses personal and till confirmations', () => {
    expect(
      parseMpesaSms(
        'QKA1B2C3D4 Confirmed.You have received Ksh30,000.00 from JANE WANJIRU 0712000111 on 21/10/26 at 10:15 AM  New M-PESA balance is Ksh45,000.00. Separate personal and business funds through Pochi la Biashara',
      ),
    ).toEqual({
      providerRef: 'QKA1B2C3D4',
      paidAt: new Date('2026-10-21T07:15:00Z'),
      amountCents: 3_000_000n,
      msisdn: '+254712000111',
      payerName: 'JANE WANJIRU',
      accountRef: null,
    });
    expect(
      parseMpesaSms(
        'QKA1B2C3D6 Confirmed. Ksh1,500.00 received from 254722000222 BRIAN OTIENO on 1/11/26 at 4:05 PM. New Account balance is Ksh9,000.00.',
      ),
    ).toMatchObject({
      providerRef: 'QKA1B2C3D6',
      paidAt: new Date('2026-11-01T13:05:00Z'),
      amountCents: 150_000n,
      msisdn: '+254722000222',
      payerName: 'BRIAN OTIENO',
    });
  });

  it('rejects outgoing and unrelated messages', () => {
    expect(() =>
      parseMpesaSms(
        'QKA1B2C3D7 Confirmed. Ksh500.00 sent to JOHN 0711000000 on 21/10/26 at 1:00 PM.',
      ),
    ).toThrow(/leaving/);
    expect(() => parseMpesaSms('Hello, your parcel has arrived')).toThrow(/does not look like/);
  });
});
