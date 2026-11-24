package ke.kejasha.app.ui

import ke.kejasha.api.models.BookingStatus
import ke.kejasha.api.models.CalendarEntry
import ke.kejasha.api.models.RentRollItemsInner
import ke.kejasha.api.models.UnitMode
import ke.kejasha.api.models.UnitStatus
import ke.kejasha.app.ui.homes.TileState
import ke.kejasha.app.ui.homes.tilesFor
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.UUID
import ke.kejasha.api.models.Unit as KUnit

class UnitBoardTest {
    private val today = "2026-11-24"
    private fun unit(code: String, mode: UnitMode = UnitMode.LONG_TERM, status: UnitStatus = UnitStatus.ACTIVE) = KUnit(
        UUID.randomUUID(), UUID.randomUUID(), "Acacia", code, null, mode, status, 2, 1, "1", null, 2_000_000, null, null, null, null, null,
        "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
    )
    private fun roll(u: KUnit, occupied: Boolean, balance: Long = 0) = RentRollItemsInner(
        u.id, u.code, "Acacia", if (occupied) RentRollItemsInner.Status.OCCUPIED else RentRollItemsInner.Status.VACANT,
        null, if (occupied) "Kamau" else null, 2_000_000, null, null, balance,
    )
    private fun stay(start: String, end: String, status: BookingStatus?, kind: CalendarEntry.Kind = CalendarEntry.Kind.BOOKING) =
        CalendarEntry(kind, UUID.randomUUID(), start, end, "Guest", status, null)

    @Test fun `long-term units are let, owing or vacant from the rent roll`() {
        val let = unit("A1"); val owing = unit("A2"); val vacant = unit("A3"); val off = unit("A4", status = UnitStatus.INACTIVE)
        val tiles = tilesFor(listOf(let, owing, vacant, off), listOf(roll(let, true), roll(owing, true, 150_000), roll(vacant, false)), emptyMap(), today)
        assertEquals(listOf(TileState.LET, TileState.OWING, TileState.VACANT, TileState.OFF), tiles.map { it.state })
        assertEquals(150_000L, tiles[1].owesCents)
    }

    @Test fun `short stays read today's calendar and departures free the unit`() {
        val inHouse = unit("S1", UnitMode.SHORT_STAY); val booked = unit("S2", UnitMode.SHORT_STAY)
        val blocked = unit("S3", UnitMode.SHORT_STAY); val leftToday = unit("S4", UnitMode.SHORT_STAY)
        val cal = mapOf(
            inHouse.id to listOf(stay("2026-11-22", "2026-11-26", BookingStatus.CHECKED_IN)),
            booked.id to listOf(stay("2026-11-24", "2026-11-25", BookingStatus.CONFIRMED)),
            blocked.id to listOf(stay("2026-11-20", "2026-11-30", null, CalendarEntry.Kind.BLOCK)),
            leftToday.id to listOf(stay("2026-11-20", "2026-11-24", BookingStatus.CHECKED_OUT)),
        )
        val tiles = tilesFor(listOf(inHouse, booked, blocked, leftToday), emptyList(), cal, today)
        assertEquals(listOf(TileState.IN_HOUSE, TileState.BOOKED, TileState.BLOCKED, TileState.FREE), tiles.map { it.state })
    }
}
