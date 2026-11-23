package ke.kejasha.app.ui

import ke.kejasha.api.models.TicketStatus
import ke.kejasha.api.models.TicketStatusInput
import ke.kejasha.app.MainDispatcherRule
import ke.kejasha.app.TestApi
import ke.kejasha.app.settle
import ke.kejasha.app.net.IdempotencyInterceptor
import ke.kejasha.app.ui.common.Loadable
import ke.kejasha.app.ui.owner.MoneyQueues
import ke.kejasha.app.ui.owner.MoneyViewModel
import ke.kejasha.app.ui.owner.Today
import ke.kejasha.app.ui.owner.TodayViewModel
import ke.kejasha.app.ui.repairs.TicketStep
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import java.util.UUID

class OwnerViewModelsTest {
    @get:Rule val main = MainDispatcherRule()
    private val api = TestApi()

    @After fun close() = api.close()

    private val cashId = UUID.randomUUID()
    private val cash = """{"id":"$cashId","leaseId":null,"bookingId":null,"unitCode":"A1","payerName":"Kamau","amountCents":500000,
        "receivedOn":"2026-11-20","note":null,"receipt":null,"status":"pending","submittedBy":"${UUID.randomUUID()}",
        "decidedBy":null,"decidedAt":null,"rejectReason":null,"paymentId":null,"createdAt":"2026-11-20T08:00:00Z"}"""

    @Test fun `money loads the unmatched and pending queues`() = runTest(main.dispatcher) {
        api.reply("""{"items":[],"nextCursor":null}""")
        api.reply("""{"items":[$cash],"nextCursor":null}""")
        val vm = MoneyViewModel(api.create())
        settle { vm.state.value is Loadable.Ready }
        val q = (vm.state.value as Loadable.Ready<MoneyQueues>).data
        assertEquals(1, q.cash.size)
        val paths = listOf(api.server.takeRequest().target, api.server.takeRequest().target).sorted()
        assertEquals(listOf("/v1/cash-collections?limit=100&status=pending", "/v1/payments?limit=100&status=unmatched"), paths)
    }

    @Test fun `confirming cash posts once with an idempotency key and reloads`() = runTest(main.dispatcher) {
        repeat(2) { api.reply("""{"items":[],"nextCursor":null}""") }
        val vm = MoneyViewModel(api.create())
        settle { vm.state.value is Loadable.Ready }
        repeat(2) { api.server.takeRequest() }

        api.reply(cash.replace("\"pending\"", "\"confirmed\""))
        repeat(2) { api.reply("""{"items":[],"nextCursor":null}""") }
        vm.confirmCash(cashId)
        settle { vm.message.value != null }

        val post = api.server.takeRequest()
        assertEquals("POST", post.method)
        assertEquals("/v1/cash-collections/$cashId/confirm", post.target)
        assertNotNull(post.headers[IdempotencyInterceptor.HEADER])
        assertEquals("Cash confirmed and recorded as a payment", vm.message.value)
    }

    @Test fun `a refused action leaves the data and explains`() = runTest(main.dispatcher) {
        repeat(2) { api.reply("""{"items":[],"nextCursor":null}""") }
        val vm = MoneyViewModel(api.create())
        settle { vm.state.value is Loadable.Ready }
        api.reply("""{"type":"about:blank","title":"Forbidden","status":403,"code":"forbidden","detail":"Only owners and managers can confirm cash."}""", 403)
        vm.confirmCash(cashId)
        settle { vm.message.value != null }
        assertEquals("Only owners and managers can confirm cash.", vm.message.value)
        assert(vm.state.value is Loadable.Ready)
    }

    @Test fun `today hides counts a role may not read`() = runTest(main.dispatcher) {
        api.server.dispatcher = object : mockwebserver3.Dispatcher() {
            override fun dispatch(request: mockwebserver3.RecordedRequest): mockwebserver3.MockResponse {
                val path = request.target
                val (code, body) = when {
                    path.startsWith("/v1/reports/owner-dashboard") -> 200 to """{"period":"2026-11","landlordName":"Acacia","collectedCents":100,
                        "expensesCents":0,"managementFeeCents":0,"netCents":100,"arrearsCents":0,"longTermOccupancyBps":0,
                        "shortStayOccupancyBps":0,"activeTickets":2,"trend":[]}"""
                    path.startsWith("/v1/bookings") -> 200 to """{"items":[],"nextCursor":null}"""
                    else -> 403 to """{"type":"about:blank","title":"Forbidden","status":403,"code":"forbidden"}"""
                }
                return mockwebserver3.MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()
            }
        }
        val vm = TodayViewModel(api.create(), api.create(), api.create())
        settle { vm.state.value is Loadable.Ready }
        val t = (vm.state.value as Loadable.Ready<Today>).data
        assertNull(t.toMatch)
        assertNull(t.cashPending)
        assertEquals(2, t.dashboard.activeTickets)
    }

    @Test fun `a repair moves open to in progress to resolved to closed`() {
        assertEquals(TicketStatusInput.IN_PROGRESS, TicketStep.after(TicketStatus.OPEN)?.to)
        assertEquals(TicketStep.RESOLVE, TicketStep.after(TicketStatus.IN_PROGRESS))
        assert(TicketStep.RESOLVE.asksCost)
        assertEquals(TicketStatusInput.CLOSED, TicketStep.after(TicketStatus.RESOLVED)?.to)
        assertNull(TicketStep.after(TicketStatus.CLOSED))
        assertNull(TicketStep.after(TicketStatus.CANCELLED))
    }
}
