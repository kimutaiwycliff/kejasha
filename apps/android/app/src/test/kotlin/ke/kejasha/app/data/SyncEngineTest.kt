package ke.kejasha.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.WorkManagerTestInitHelper
import ke.kejasha.api.models.TicketCategoryInput
import ke.kejasha.api.models.TicketPriorityInput
import ke.kejasha.api.models.TicketStatusInput
import ke.kejasha.app.data.db.KejashaDb
import ke.kejasha.app.data.sync.CaretakerRepository
import ke.kejasha.app.data.sync.SyncEngine
import ke.kejasha.app.data.sync.SyncScheduler
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.IdempotencyInterceptor
import ke.kejasha.app.net.NetworkModule
import ke.kejasha.app.net.Uploader
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/** The caretaker's offline shift against a fake API: queue offline, push once, pull back. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SyncEngineTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val org = UUID.randomUUID().toString()
    private val property = UUID.randomUUID().toString()
    private val unit = UUID.randomUUID().toString()
    private val meter = UUID.randomUUID().toString()

    private lateinit var db: KejashaDb
    private lateinit var server: MockWebServer
    private lateinit var engine: SyncEngine
    private lateinit var repo: CaretakerRepository

    private val pushes = CopyOnWriteArrayList<RecordedRequest>()
    private val uploads = CopyOnWriteArrayList<String>()
    /** How the fake API answers a push: per record id, "applied" by default. */
    private var pushStatus: (String) -> String = { "applied" }
    private var failNextPush = false
    /** Extra records the next pull returns (as the API would after applying a push). */
    private var pullItems: () -> String = { "" }
    private var pullReset = true

    @Before fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        db = Room.inMemoryDatabaseBuilder(context, KejashaDb::class.java).allowMainThreadQueries().build()
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath
                return when {
                    path == "/v1/uploads" -> {
                        val key = "org/$org/x/${UUID.randomUUID()}.jpg"
                        json("""{"key":"$key","uploadUrl":"${server.url("/s3/$key")}","method":"PUT","headers":{"content-type":"image/jpeg"},"expiresAt":"2030-01-01T00:00:00Z"}""")
                    }
                    path.startsWith("/s3/") -> { uploads += path; MockResponse.Builder().code(200).build() }
                    path == "/v1/sync/push" -> {
                        pushes += request
                        if (failNextPush) { failNextPush = false; return MockResponse.Builder().code(503).body("{}").build() }
                        val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
                        val results = listOf("tickets" to "ticket", "ticketUpdates" to "ticket_update", "meterReadings" to "meter_reading", "cashCollections" to "cash_collection")
                            .flatMap { (field, type) ->
                                body[field]?.jsonArray.orEmpty().mapNotNull { item ->
                                    val id = item.jsonObject["id"]!!.jsonPrimitive.content
                                    // "skip": the API leaves it out of the answer, so it stays queued.
                                    val status = pushStatus(id).takeIf { it != "skip" } ?: return@mapNotNull null
                                    val (code, msg) = if (status == "rejected") "\"ticket_finished\"" to "\"The repair is already closed.\"" else "null" to "null"
                                    """{"id":"$id","type":"$type","status":"$status","code":$code,"message":$msg}"""
                                }
                            }
                        json("""{"results":[${results.joinToString(",")}]}""")
                    }
                    path == "/v1/sync/pull" -> json(pull())
                    else -> MockResponse.Builder().code(404).build()
                }
            }
        }
        server.start()
        val http = OkHttpClient.Builder().addInterceptor(IdempotencyInterceptor()).build()
        val retrofit = NetworkModule.buildRetrofit(server.url("/").toString(), http)
        engine = SyncEngine(db, retrofit.create(ke.kejasha.api.endpoints.SyncApi::class.java), Uploader(retrofit.create(ke.kejasha.api.endpoints.PlatformApi::class.java), OkHttpClient()))
        repo = CaretakerRepository(context, db, SyncScheduler(context))
    }

    @After fun tearDown() {
        db.close()
        server.close()
    }

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private fun pull(): String {
        val ts = "2026-11-23T08:00:00Z"
        val reset = pullReset
        pullReset = false
        val extra = pullItems()
        return """{"cursor":"c${System.nanoTime()}","reset":$reset,"hasMore":false,"changes":{
            "properties":{"upserted":[{"id":"$property","name":"Acacia Court","kind":"residential","county":"Nairobi","area":null,"updatedAt":"$ts"}],"deleted":[]},
            "units":{"upserted":[{"id":"$unit","propertyId":"$property","code":"A1","label":null,"mode":"long_term","status":"active","bedrooms":2,"updatedAt":"$ts"}],"deleted":[]},
            "meters":{"upserted":[{"id":"$meter","unitId":"$unit","kind":"water","serial":"W-1","unitLabel":"m³","updatedAt":"$ts"}],"deleted":[]},
            "meterReadings":{"upserted":[$extra],"deleted":[]},
            "tickets":{"upserted":[],"deleted":[]},"ticketUpdates":{"upserted":[],"deleted":[]},
            "cashCollections":{"upserted":[],"deleted":[]},"tenants":{"upserted":[],"deleted":[]},"leases":{"upserted":[],"deleted":[]}}}"""
    }

    private fun photo(): File = File(context.filesDir, "p-${UUID.randomUUID()}.jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }

    private fun pushedBody(i: Int): JsonObject = Json.parseToJsonElement(pushes[i].body!!.utf8()).jsonObject

    @Test fun `an offline shift is pushed once with photos uploaded first`() = runBlocking {
        engine.sync(org) // first download
        repo.reportTicket(org, property, unit, "Leaking tap", TicketCategoryInput.PLUMBING, TicketPriorityInput.HIGH, null, listOf(photo()))
        val ticket = db.caretaker().tickets().first().single()
        repo.updateTicket(org, ticket.id, "open", "Washer replaced", TicketStatusInput.RESOLVED, null, emptyList())
        repo.recordReading(org, meter, "2026-11-23", "1234.5", null)
        repo.logCash(org, unit, 500_000, "2026-11-23", "Kamau", null, photo())
        assertEquals(4, db.outbox().pendingCount(org).first())

        val outcome = engine.sync(org)

        assertEquals(4, outcome.pushed)
        assertEquals(2, uploads.size)
        assertEquals(1, pushes.size)
        val body = pushedBody(0)
        assertEquals(1, body["tickets"]!!.jsonArray.size)
        assertEquals(1, body["tickets"]!!.jsonArray[0].jsonObject["photoKeys"]!!.jsonArray.size)
        assertEquals("resolved", body["ticketUpdates"]!!.jsonArray[0].jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("1234.5", body["meterReadings"]!!.jsonArray[0].jsonObject["reading"]!!.jsonPrimitive.content)
        assertEquals(unit, body["cashCollections"]!!.jsonArray[0].jsonObject["unitId"]!!.jsonPrimitive.content)
        assertTrue(body["cashCollections"]!!.jsonArray[0].jsonObject["receiptKey"]!!.jsonPrimitive.content.startsWith("org/"))
        assertEquals(0, db.outbox().pendingCount(org).first())
        assertTrue(File(context.filesDir, "outbox").listFiles().orEmpty().isEmpty())

        // Nothing left: a second sync pushes nothing.
        engine.sync(org)
        assertEquals(1, pushes.size)
    }

    @Test fun `a failed push is retried with the same records and key, without uploading twice`() = runBlocking {
        engine.sync(org)
        repo.reportTicket(org, property, null, "Broken gate", TicketCategoryInput.SECURITY, TicketPriorityInput.NORMAL, null, listOf(photo()))
        failNextPush = true
        val failed = runCatching { engine.sync(org) }.exceptionOrNull()
        assertTrue(failed is ApiError.Http)
        assertEquals(1, db.outbox().pendingCount(org).first())
        assertTrue(db.syncState().get(org)?.lastError != null)

        engine.sync(org)
        assertEquals(2, pushes.size)
        assertEquals(1, uploads.size)
        assertEquals(pushedBody(0), pushedBody(1))
        assertEquals(pushes[0].headers[IdempotencyInterceptor.HEADER], pushes[1].headers[IdempotencyInterceptor.HEADER])
        assertEquals(0, db.outbox().pendingCount(org).first())
    }

    @Test fun `a refused record becomes a dead letter the caretaker can discard`() = runBlocking {
        engine.sync(org)
        repo.recordReading(org, meter, "2026-11-23", "99", null)
        val id = db.outbox().pending(org, 10).single().id
        pushStatus = { "rejected" }
        val outcome = engine.sync(org)
        assertEquals(1, outcome.rejected)
        val dead = db.outbox().dead(org).first().single()
        assertEquals("ticket_finished", dead.errorCode)
        assertEquals("The repair is already closed.", dead.error)
        assertTrue(db.caretaker().readings().first().any { it.id == id })

        repo.discard(id)
        assertTrue(db.outbox().dead(org).first().isEmpty())
        assertFalse(db.caretaker().readings().first().any { it.id == id })
    }

    @Test fun `pulled records replace local copies and a reset keeps what is unsent`() = runBlocking {
        engine.sync(org)
        repo.recordReading(org, meter, "2026-11-23", "10", null)
        val sentId = db.outbox().pending(org, 10).single().id
        // The API applies it and sends it back on the pull of the same sync.
        pullItems = { """{"id":"$sentId","meterId":"$meter","readOn":"2026-11-23","reading":"10","note":null,"recordedBy":null,"updatedAt":"2026-11-23T08:00:00Z"}""" }
        engine.sync(org)
        assertFalse(db.caretaker().readings().first().single { it.id == sentId }.local)

        // A new reading the API does not take yet, then a full snapshot (reset) arrives.
        pullItems = { "" }
        repo.recordReading(org, meter, "2026-11-24", "11", null)
        pushStatus = { "skip" }
        pullReset = true
        engine.sync(org)
        val readings = db.caretaker().readings().first()
        assertTrue(readings.any { it.reading == "11" && it.local })
        assertFalse(readings.any { it.id == sentId })
        assertEquals(1, db.outbox().pendingCount(org).first())
    }

    @Test fun `another organization starts from a fresh snapshot`() = runBlocking {
        engine.sync(org)
        assertEquals(1, db.caretaker().properties().first().size)
        val other = UUID.randomUUID().toString()
        pullReset = true
        engine.sync(other)
        assertEquals(1, db.caretaker().properties().first().size)
        assertEquals(null, db.syncState().get(org))
        assertTrue(db.syncState().get(other)?.cursor?.startsWith("c") == true)
    }
}
