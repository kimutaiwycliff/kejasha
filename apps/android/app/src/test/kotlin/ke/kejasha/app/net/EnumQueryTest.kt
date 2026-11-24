package ke.kejasha.app.net

import ke.kejasha.api.endpoints.MaintenanceApi.ActiveListTickets
import ke.kejasha.api.models.MatchStatusInput
import org.junit.Assert.assertEquals
import org.junit.Test

class EnumQueryTest {
    @Test fun `enums are sent as their wire values`() {
        assertEquals("true", EnumQueryConverterFactory.wireName(ActiveListTickets.TRUE))
        assertEquals("unmatched", EnumQueryConverterFactory.wireName(MatchStatusInput.UNMATCHED))
    }
}
