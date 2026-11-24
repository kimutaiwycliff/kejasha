package ke.kejasha.app.net

import ke.kejasha.api.models.OwnerDashboard
import org.junit.Assert.assertNull
import org.junit.Test

/** The generated models accept what the API sends (found on a device: the dashboard failed to load). */
class GeneratedModelsTest {
    @Test fun `a null the spec allows decodes`() {
        val d = ApiJson.decodeFromString(
            OwnerDashboard.serializer(),
            """{"period":"2026-11","landlordName":null,"collectedCents":0,"expensesCents":0,"managementFeeCents":0,"netCents":0,
               "arrearsCents":0,"longTermOccupancyBps":0,"shortStayOccupancyBps":0,"activeTickets":0,"trend":[]}""",
        )
        assertNull(d.landlordName)
    }
}
