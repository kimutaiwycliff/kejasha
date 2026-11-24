package ke.kejasha.app.util

import org.junit.Assert.assertEquals
import org.junit.Test

/** The preview must read what the API books (apps/api payments/parsers.ts). */
class MpesaSmsTest {
    @Test fun `a paybill confirmation is read`() {
        val p = previewMpesaSms(
            "SJK3H5L9QZ Confirmed. You have received Ksh25,000.00 from JOHN KAMAU 0712345678 on 5/11/26 at 9:14 AM " +
                "New M-PESA balance is Ksh80,500.00. Account number A12",
        ) as SmsPreview.Incoming
        assertEquals("SJK3H5L9QZ", p.code)
        assertEquals(2_500_000L, p.amountCents)
        assertEquals("JOHN KAMAU 0712345678", p.from)
        assertEquals("5/11/2026 9:14 AM", p.paidOn)
        assertEquals("A12", p.accountRef)
    }

    @Test fun `a till confirmation is read`() {
        val p = previewMpesaSms("RKL1M2N3P4 Confirmed. Ksh1,500.50 received from 254712345678 MARY ATIENO on 12/3/2026 at 4:05 PM.") as SmsPreview.Incoming
        assertEquals(150_050L, p.amountCents)
        assertEquals(null, p.accountRef)
    }

    @Test fun `money leaving the account is never a payment`() {
        assertEquals(SmsPreview.Outgoing, previewMpesaSms("QWE1234567 Confirmed. Ksh500.00 sent to JANE DOE 0711111111 on 1/1/26 at 1:00 PM."))
        assertEquals(SmsPreview.Outgoing, previewMpesaSms("QWE1234567 Confirmed. Ksh500.00 paid to KPLC PREPAID on 1/1/26 at 1:00 PM."))
    }

    @Test fun `other text is not recognised`() {
        assertEquals(SmsPreview.NotRecognised, previewMpesaSms("Hello, rent will be paid on Friday."))
    }
}
