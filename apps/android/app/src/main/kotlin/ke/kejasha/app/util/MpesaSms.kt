package ke.kejasha.app.util

/**
 * A preview of a shared M-Pesa SMS, read the same way as the API (apps/api payments/parsers.ts).
 * Only for showing the person what will be added: `POST /v1/sms-payments` decides.
 */
sealed interface SmsPreview {
    data class Incoming(val code: String, val amountCents: Long, val from: String, val paidOn: String, val accountRef: String?) : SmsPreview

    /** Money leaving the account ("sent to", "paid to"…): never booked as rent. */
    data object Outgoing : SmsPreview

    data object NotRecognised : SmsPreview
}

private val OUTGOING = Regex("""\b(sent to|paid to|withdraw|bought|you have sent)\b""", RegexOption.IGNORE_CASE)
private val CODE = Regex("""^([A-Z0-9]{10})\s+Confirmed""", RegexOption.IGNORE_CASE)
private val AMOUNT = Regex("""(?:received|have received)\s+Ksh\s?([\d,]+\.\d{2})|Ksh\s?([\d,]+\.\d{2})\s+received""", RegexOption.IGNORE_CASE)
private val FROM = Regex("""from\s+(.+?)\s+on\s+(\d{1,2})/(\d{1,2})/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)""", RegexOption.IGNORE_CASE)
private val ACCOUNT = Regex("""account (?:number )?([A-Za-z0-9-]{1,12})\b""", RegexOption.IGNORE_CASE)

fun previewMpesaSms(text: String): SmsPreview {
    val t = text.replace(Regex("""\s+"""), " ").trim()
    if (OUTGOING.containsMatchIn(t)) return SmsPreview.Outgoing
    val code = CODE.find(t)?.groupValues?.get(1) ?: return SmsPreview.NotRecognised
    val amount = AMOUNT.find(t)?.let { m -> m.groupValues[1].ifEmpty { m.groupValues[2] } } ?: return SmsPreview.NotRecognised
    val from = FROM.find(t) ?: return SmsPreview.NotRecognised
    val (who, day, month, year, hour, minute, ampm) = from.destructured
    val cents = parseKes(amount) ?: return SmsPreview.NotRecognised
    val fullYear = if (year.length == 2) "20$year" else year
    val paidOn = "$day/$month/$fullYear $hour:$minute ${ampm.uppercase()}"
    return SmsPreview.Incoming(code.uppercase(), cents, who.trim(), paidOn, ACCOUNT.find(t)?.groupValues?.get(1))
}
