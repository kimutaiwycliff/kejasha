package ke.kejasha.app.util

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

class MoneyTest {
    @Test fun `cents format exactly as shillings`() {
        assertEquals("Ksh 0.00", formatKes(0))
        assertEquals("Ksh 2,500.00", formatKes(250_000))
        assertEquals("Ksh 0.05", formatKes(5))
        assertEquals("-Ksh 1,234.56", formatKes(-123_456))
        assertEquals("Ksh 92,233,720,368,547,758.07", formatKes(Long.MAX_VALUE))
    }

    @Test fun `business dates are in Nairobi`() {
        // 22:30 UTC on 31 Jan is already 1 Feb in Nairobi (UTC+3).
        val clock = Clock.fixed(Instant.parse("2026-01-31T22:30:00Z"), ZoneOffset.UTC)
        assertEquals(LocalDate.of(2026, 2, 1), todayNairobi(clock))
    }
}
