package ke.kejasha.app.util

import java.math.BigDecimal
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

private val amount = DecimalFormat("#,##0.00", DecimalFormatSymbols(Locale.US))

/** Cents → "Ksh 1,234.50" (matches the web app). Exact: no floating point (ADR-006). */
fun formatKes(cents: Long): String {
    val text = synchronized(amount) { amount.format(BigDecimal.valueOf(cents, 2).abs()) }
    return if (cents < 0) "-Ksh $text" else "Ksh $text"
}

val NAIROBI: ZoneId = ZoneId.of("Africa/Nairobi")

/** Today's business date in Africa/Nairobi. */
fun todayNairobi(clock: Clock = Clock.systemUTC()): LocalDate = LocalDate.now(clock.withZone(NAIROBI))
