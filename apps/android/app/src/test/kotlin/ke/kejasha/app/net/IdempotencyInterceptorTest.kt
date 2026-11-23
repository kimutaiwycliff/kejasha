package ke.kejasha.app.net

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class IdempotencyInterceptorTest {
    private val server = MockWebServer()
    private var clock = 0L
    private val client = OkHttpClient.Builder()
        .addInterceptor(IdempotencyInterceptor(now = { clock }, ttlMillis = 1_000))
        .retryOnConnectionFailure(false)
        .build()

    @Before fun start() = server.start()
    @After fun stop() = server.close()

    private fun post(body: String = """{"a":1}""", path: String = "/v1/things", header: String? = null): Int {
        val request = Request.Builder().url(server.url(path))
            .post(body.toRequestBody("application/json".toMediaType()))
            .apply { header?.let { header(IdempotencyInterceptor.HEADER, it) } }
            .build()
        return client.newCall(request).execute().use { it.code }
    }

    private fun reply(code: Int) = server.enqueue(MockResponse.Builder().code(code).body("{}").build())
    private fun sentKey() = server.takeRequest().headers[IdempotencyInterceptor.HEADER]

    @Test fun `reads carry no key`() {
        reply(200)
        client.newCall(Request.Builder().url(server.url("/v1/things")).build()).execute().close()
        assertNull(sentKey())
    }

    @Test fun `a retry after a 5xx reuses the key`() {
        reply(503); reply(201)
        post(); post()
        assertEquals(sentKey(), sentKey())
    }

    @Test fun `a retry while the first is still running reuses the key`() {
        reply(409); reply(201)
        post(); post()
        assertEquals(sentKey(), sentKey())
    }

    @Test fun `a new action after a final answer gets a new key`() {
        reply(201); reply(201)
        post(); post()
        assertNotEquals(sentKey(), sentKey())
    }

    @Test fun `different bodies or paths get different keys`() {
        reply(503); reply(503); reply(503)
        post("""{"a":1}"""); post("""{"a":2}"""); post(path = "/v1/other")
        val keys = setOf(sentKey(), sentKey(), sentKey())
        assertEquals(3, keys.size)
    }

    @Test fun `a pending key expires`() {
        reply(503); reply(201)
        post(); clock += 2_000; post()
        assertNotEquals(sentKey(), sentKey())
    }

    @Test fun `an explicit key is kept`() {
        reply(201)
        post(header = "batch-0001")
        assertEquals("batch-0001", sentKey())
    }
}
