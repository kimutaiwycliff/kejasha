package ke.kejasha.app.net

import ke.kejasha.api.models.OwnerDashboard
import ke.kejasha.api.models.PropertyPage
import ke.kejasha.api.models.RentRoll
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

    @Test fun `a vacant unit in the rent roll decodes (nullable ids and dates in nested objects)`() {
        val r = ApiJson.decodeFromString(
            RentRoll.serializer(),
            """{"asOf":"2026-11-24","items":[{"unitId":"01a20c85-36ba-719e-9139-96d319e8070c","unitCode":"A1","propertyName":"Acacia",
               "status":"vacant","leaseId":null,"tenantName":null,"rentCents":2000000,"leaseStart":null,"leaseEnd":null,"balanceCents":0}],
               "totals":{"units":1,"occupied":0,"occupancyBps":0,"rentCents":0,"balanceCents":0}}""",
        )
        assertNull(r.items.single().leaseId)
        assertNull(r.items.single().tenantName)
    }

    @Test fun `coordinates decode as JSON numbers`() {
        val page = ApiJson.decodeFromString(
            PropertyPage.serializer(),
            """{"items":[{"id":"01a20c85-36ba-719e-9139-96d319e8070c","clientLandlordId":"01a20c85-36ba-719e-9139-96d319e8070d",
               "clientLandlordName":"Self","name":"Acacia","kind":"residential","county":"Kisumu","area":null,"address":null,
               "latitude":-0.0917,"longitude":34.768,"notes":null,"unitCounts":{"total":1,"longTerm":1,"shortStay":0},
               "archivedAt":null,"createdAt":"2026-11-24T08:00:00Z","updatedAt":"2026-11-24T08:00:00Z"}],"nextCursor":null}""",
        )
        org.junit.Assert.assertEquals(-0.0917, page.items.single().latitude!!, 1e-9)
    }
}
