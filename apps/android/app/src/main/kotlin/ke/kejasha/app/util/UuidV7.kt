package ke.kejasha.app.util

import java.security.SecureRandom
import java.util.UUID

private val random = SecureRandom()

/**
 * A time-ordered UUID (RFC 9562 v7) for records created offline: the API treats a repeat of the
 * same id as a duplicate, so a record pushed twice is applied once.
 */
fun uuidV7(nowMillis: Long = System.currentTimeMillis()): UUID {
    val bytes = ByteArray(16).also(random::nextBytes)
    for (i in 0 until 6) bytes[i] = (nowMillis ushr (40 - 8 * i)).toByte()
    bytes[6] = ((bytes[6].toInt() and 0x0F) or 0x70).toByte() // version 7
    bytes[8] = ((bytes[8].toInt() and 0x3F) or 0x80).toByte() // RFC 4122 variant
    var msb = 0L
    var lsb = 0L
    for (i in 0 until 8) msb = (msb shl 8) or (bytes[i].toLong() and 0xFF)
    for (i in 8 until 16) lsb = (lsb shl 8) or (bytes[i].toLong() and 0xFF)
    return UUID(msb, lsb)
}
