package ke.kejasha.app.net

import ke.kejasha.api.models.Me
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response
import java.io.IOException

class ApiErrorTest {
    private fun problem(status: Int, json: String): Response<Me> =
        Response.error(status, json.toResponseBody("application/problem+json".toMediaType()))

    @Test fun `problem details become a typed error with field messages`() {
        val e = runCatching {
            runBlocking {
                api {
                    problem(
                        422,
                        """{"type":"about:blank","title":"Invalid request","status":422,"code":"validation_failed",
                           "errors":[{"path":"body.phone","message":"Enter a Kenyan mobile number"}]}""",
                    )
                }
            }
        }.exceptionOrNull() as ApiError.Http
        assertEquals(422, e.status)
        assertEquals("validation_failed", e.code)
        assertEquals(mapOf("phone" to "Enter a Kenyan mobile number"), e.fieldErrors)
        assertEquals("Invalid request", e.userMessage)
    }

    @Test fun `unpaid subscriptions point to billing`() {
        val e = ApiError.from(problem(402, """{"type":"x","title":"Payment required","status":402,"code":"subscription_required"}"""))
        assertTrue(e.userMessage.contains("Billing"))
    }

    @Test fun `a body that is not problem json still gives a status`() {
        val e = ApiError.from(problem(502, "<html>bad gateway</html>"))
        assertEquals(502, e.status)
        assertEquals("http_502", e.code)
    }

    @Test fun `an answer the app cannot decode is an error, not a crash`() {
        val e = runCatching { runBlocking { api<Me> { throw kotlinx.serialization.SerializationException("bad") } } }.exceptionOrNull()
        assertTrue(e is ApiError.Unreadable)
    }

    @Test fun `no response is a network error`() {
        val e = runCatching { runBlocking { api<Me> { throw IOException("offline") } } }.exceptionOrNull()
        assertTrue(e is ApiError.Network)
    }
}
