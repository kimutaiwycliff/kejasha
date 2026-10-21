import { phone } from '@kejasha/core';
import { z } from 'zod';

export const COUNTIES = [
  'Baringo',
  'Bomet',
  'Bungoma',
  'Busia',
  'Elgeyo-Marakwet',
  'Embu',
  'Garissa',
  'Homa Bay',
  'Isiolo',
  'Kajiado',
  'Kakamega',
  'Kericho',
  'Kiambu',
  'Kilifi',
  'Kirinyaga',
  'Kisii',
  'Kisumu',
  'Kitui',
  'Kwale',
  'Laikipia',
  'Lamu',
  'Machakos',
  'Makueni',
  'Mandera',
  'Marsabit',
  'Meru',
  'Migori',
  'Mombasa',
  "Murang'a",
  'Nairobi',
  'Nakuru',
  'Nandi',
  'Narok',
  'Nyamira',
  'Nyandarua',
  'Nyeri',
  'Samburu',
  'Siaya',
  'Taita-Taveta',
  'Tana River',
  'Tharaka-Nithi',
  'Trans Nzoia',
  'Turkana',
  'Uasin Gishu',
  'Vihiga',
  'Wajir',
  'West Pokot',
] as const;

export const County = z
  .enum(COUNTIES)
  .meta({ id: 'County', description: 'One of the 47 counties of Kenya' });

/** Accepts any common Kenyan format (07…, 01…, +254…, 254…) and normalises to E.164. */
// Accepted shapes, documented in the spec so clients and fuzzers know them: optional +254 / 254 /
// 00254 / 0 prefix, then 7xx or 1xx and 8 more digits, with optional spaces, dots, dashes, brackets.
const KENYAN_PHONE_PATTERN = /^[\s(]*(?:\+?254|00254|0)?[\s().-]*[17](?:[\s().-]*\d){8}[\s)]*$/;

export const PhoneInput = z
  .string()
  .max(24)
  .regex(KENYAN_PHONE_PATTERN, 'Enter a Kenyan mobile number, e.g. 0712 345 678')
  .transform((value, ctx) => {
    const e164 = phone.normalizeKenyanPhone(value);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a Kenyan mobile number, e.g. 0712 345 678' });
      return z.NEVER;
    }
    return e164;
  })
  .meta({
    description: 'Kenyan mobile number; any common format, normalised to E.164',
    example: '0712345678',
  });

export const Phone = z
  .string()
  .meta({ description: 'E.164 phone number', example: '+254712345678' });

/** KRA PIN: A/P + 9 digits + letter, e.g. A123456789Z. Upper-cased on input. */
export const KraPin = z
  .string()
  .regex(/^[AaPp][0-9]{9}[A-Za-z]$/, 'KRA PIN looks like A123456789Z')
  .transform((v) => v.toUpperCase())
  .meta({ example: 'A123456789Z' });

/** RFC 5321 limits: 254 overall, 64 for the local part. Lower-cased on input. */
export const Email = z
  .email()
  .max(254)
  .refine((v) => (v.split('@')[0] ?? '').length <= 64, 'The part before @ is too long')
  .transform((v) => v.toLowerCase());
