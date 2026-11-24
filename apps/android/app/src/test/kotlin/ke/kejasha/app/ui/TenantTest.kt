package ke.kejasha.app.ui

import ke.kejasha.api.models.TicketCategoryInput
import ke.kejasha.app.MainDispatcherRule
import ke.kejasha.app.TestApi
import ke.kejasha.app.settle
import ke.kejasha.app.ui.common.Loadable
import ke.kejasha.app.ui.tenant.TenantRepairs
import ke.kejasha.app.ui.tenant.TenantRepairsViewModel
import ke.kejasha.app.ui.tenant.promptShillings
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

class TenantTest {
    @get:Rule val main = MainDispatcherRule()
    private val api = TestApi()
    private val lease = UUID.randomUUID()
    private val posts = CopyOnWriteArrayList<RecordedRequest>()

    @After fun close() = api.close()

    @Test fun `prompts are whole shillings rounded up`() {
        assertEquals(2_501L, promptShillings(250_050))
        assertEquals(2_500L, promptShillings(250_000))
        assertEquals(1L, promptShillings(1))
    }

    @Test fun `a tenant reports a problem on their active lease`() = runTest(main.dispatcher) {
        api.server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = when (request.url.encodedPath) {
                    "/v1/portal/me" -> """{"phone":"+254712345678","phoneVerified":true,"tenancies":[{"orgId":"${UUID.randomUUID()}","landlordName":"Otieno",
                        "leases":[{"leaseId":"$lease","unitCode":"A1","propertyName":"Acacia","startDate":"2026-01-01","endDate":null,"status":"active","currentRentCents":2000000,"balanceCents":0}]}]}"""
                    "/v1/portal/tickets" -> if (request.method == "POST") { posts += request; "{}" } else """{"items":[]}"""
                    else -> return MockResponse.Builder().code(404).build()
                }
                return MockResponse.Builder().code(if (request.method == "POST") 400 else 200).addHeader("Content-Type", "application/json").body(body).build()
            }
        }
        val vm = TenantRepairsViewModel(api.create())
        settle { vm.state.value is Loadable.Ready }
        assertEquals(1, (vm.state.value as Loadable.Ready<TenantRepairs>).data.leases.size)

        vm.report(lease, "  Broken window ", TicketCategoryInput.STRUCTURAL, " ")
        settle { vm.message.value != null }
        val sent = Json.parseToJsonElement(posts.single().body!!.utf8()).jsonObject
        assertEquals(lease.toString(), sent["leaseId"]!!.jsonPrimitive.content)
        assertEquals("Broken window", sent["title"]!!.jsonPrimitive.content)
        assertEquals("structural", sent["category"]!!.jsonPrimitive.content)
        assertEquals(null, sent["description"])
    }
}
