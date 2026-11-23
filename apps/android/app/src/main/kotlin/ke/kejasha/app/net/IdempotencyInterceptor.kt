package ke.kejasha.app.net

import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okio.Buffer
import java.security.MessageDigest
import java.util.UUID

/**
 * Adds an `Idempotency-Key` to every write (CLAUDE.md §2.8).
 *
 * One key per user action: an identical request (same caller, method, URL and body) sent again
 * while the first has no final answer — it failed in transit, the API answered 5xx, or it is still
 * running (409) — reuses the key, so the API applies it once and replays the answer. Once a final
 * answer arrives the key is dropped and the next identical request is a new action.
 * A request that already carries the header (a sync batch) is left alone.
 */
class IdempotencyInterceptor(
    private val now: () -> Long = System::currentTimeMillis,
    private val ttlMillis: Long = 15 * 60_000L,
) : Interceptor {
    private val pending = LinkedHashMap<String, Pending>()

    private class Pending(val key: String, val createdAt: Long)

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.method !in WRITES || request.header(HEADER) != null) return chain.proceed(request)

        val fingerprint = fingerprint(request)
        val key = if (fingerprint == null) {
            UUID.randomUUID().toString()
        } else {
            synchronized(pending) {
                val cutoff = now() - ttlMillis
                pending.entries.removeAll { it.value.createdAt < cutoff }
                pending.getOrPut(fingerprint) { Pending(UUID.randomUUID().toString(), now()) }.key
            }
        }

        val response = chain.proceed(request.newBuilder().header(HEADER, key).build())
        if (fingerprint != null && response.code < 500 && response.code != 409) {
            synchronized(pending) { pending.remove(fingerprint) }
        }
        return response
    }

    /** Null when the body can be read only once (it is not buffered, so it is not hashed). */
    private fun fingerprint(request: Request): String? {
        val body = request.body
        if (body?.isOneShot() == true) return null
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update("${request.method}\n${request.url}\n${request.header("Authorization").orEmpty()}\n".toByteArray())
        if (body != null) {
            val buffer = Buffer()
            body.writeTo(buffer)
            digest.update(buffer.readByteArray())
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val HEADER = "Idempotency-Key"
        private val WRITES = setOf("POST", "PUT", "PATCH", "DELETE")
    }
}
