package ke.kejasha.app.net

import ke.kejasha.api.models.ProblemDetails
import retrofit2.Response
import java.io.IOException

/** A failed API call: a problem+json answer from the API, or no answer at all. */
sealed class ApiError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** The API answered with an error (RFC 9457 problem details). */
    class Http(
        val status: Int,
        val code: String,
        val title: String,
        val detail: String?,
        /** Field name (without the `body.` prefix) → message. */
        val fieldErrors: Map<String, String> = emptyMap(),
    ) : ApiError(detail ?: title)

    /** No response: offline, timed out or the connection dropped. */
    class Network(cause: IOException) : ApiError("No connection. Check your internet and try again.", cause)

    /** A message fit to show the person using the app. */
    val userMessage: String
        get() = when (this) {
            is Http -> when (code) {
                "subscription_required", "subscription_suspended" ->
                    "This account's subscription needs attention. Open Billing on the web app."
                else -> detail ?: title
            }
            is Network -> message.orEmpty()
        }

    val isUnauthorized: Boolean get() = this is Http && status == 401

    companion object {
        fun from(response: Response<*>): Http {
            val raw = response.errorBody()?.string().orEmpty()
            val problem = runCatching { ApiJson.decodeFromString(ProblemDetails.serializer(), raw) }.getOrNull()
                ?: return Http(response.code(), "http_${response.code()}", response.message().ifBlank { "Request failed" }, null)
            return Http(
                status = problem.status,
                code = problem.code,
                title = problem.title,
                detail = problem.detail,
                fieldErrors = problem.errors.orEmpty().associate { it.path.removePrefix("body.") to it.message },
            )
        }
    }
}

/** Runs a generated client call and returns its body, or throws [ApiError]. */
suspend fun <T> api(call: suspend () -> Response<T>): T {
    val response = try {
        call()
    } catch (e: IOException) {
        throw ApiError.Network(e)
    }
    if (!response.isSuccessful) throw ApiError.from(response)
    @Suppress("UNCHECKED_CAST")
    return response.body() ?: Unit as T
}
