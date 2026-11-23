package ke.kejasha.app

import ke.kejasha.app.net.IdempotencyInterceptor
import ke.kejasha.app.net.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.rules.TestWatcher
import org.junit.runner.Description

/** The app's Retrofit stack against a MockWebServer, with JSON replies queued per test. */
class TestApi {
    val server = MockWebServer().apply { start() }
    val retrofit = NetworkModule.buildRetrofit(
        server.url("/").toString(),
        OkHttpClient.Builder().addInterceptor(IdempotencyInterceptor()).build(),
    )

    inline fun <reified T> create(): T = retrofit.create(T::class.java)

    fun reply(json: String, code: Int = 200) =
        server.enqueue(MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(json).build())

    fun close() = server.close()
}

/** View models launch on Dispatchers.Main; tests run them on a test dispatcher. */
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(val dispatcher: TestDispatcher = StandardTestDispatcher()) : TestWatcher() {
    override fun starting(description: Description) = Dispatchers.setMain(dispatcher)
    override fun finished(description: Description) = Dispatchers.resetMain()
}

/**
 * Calls run on OkHttp threads and resume on the test dispatcher: advance until [done] holds.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun kotlinx.coroutines.test.TestScope.settle(done: () -> Boolean) {
    repeat(500) {
        testScheduler.advanceUntilIdle()
        if (done()) return
        Thread.sleep(10)
    }
    error("Timed out waiting for the view model")
}
