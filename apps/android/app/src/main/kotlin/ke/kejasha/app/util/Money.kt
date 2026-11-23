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

/** "2,500.50" or "2500" → cents; null when it is not a positive shilling amount with ≤ 2 decimals. */
fun parseKes(text: String): Long? {
    val clean = text.trim().removePrefix("Ksh").replace(",", "").trim()
    if (!Regex("""\d{1,13}(\.\d{1,2})?""").matches(clean)) return null
    return BigDecimal(clean).movePointRight(2).longValueExact().takeIf { it > 0 }
}

/** Cents → "2500.50" for an editable field (no grouping, no currency). */
fun centsToInput(cents: Long): String = BigDecimal.valueOf(cents, 2).stripTrailingZeros().toPlainString()

private val dayFormat = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
private val dayTimeFormat = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH)

/** "2026-11-23" → "23 Nov 2026". */
fun formatDate(iso: String): String = runCatching { LocalDate.parse(iso.take(10)).format(dayFormat) }.getOrDefault(iso)

/** An ISO timestamp → "23 Nov 2026, 14:05" in Nairobi time. */
fun formatDateTime(iso: String): String =
    runCatching { java.time.OffsetDateTime.parse(iso).atZoneSameInstant(NAIROBI).format(dayTimeFormat) }.getOrDefault(iso)

/** The current business month as "YYYY-MM". */
fun currentPeriod(clock: Clock = Clock.systemUTC()): String = todayNairobi(clock).toString().take(7)
