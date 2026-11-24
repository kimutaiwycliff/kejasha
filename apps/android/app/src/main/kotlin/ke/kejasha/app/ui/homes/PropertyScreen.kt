package ke.kejasha.app.ui.homes

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.navigation.toRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.AccountsApi
import ke.kejasha.api.endpoints.ReportingApi
import ke.kejasha.api.endpoints.ShortStayApi
import ke.kejasha.api.models.BookingStatus
import ke.kejasha.api.models.CalendarEntry
import ke.kejasha.api.models.PropertyDetail
import ke.kejasha.api.models.RentRollItemsInner
import ke.kejasha.api.models.Unit as KUnit
import ke.kejasha.api.models.UnitMode
import ke.kejasha.api.models.UnitStatus
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.ui.map.KejashaMap
import ke.kejasha.app.ui.map.LngLat
import ke.kejasha.app.ui.map.MapPin
import ke.kejasha.app.ui.map.PinColors
import ke.kejasha.app.ui.map.rememberKejashaMapState
import ke.kejasha.app.ui.owner.optional
import ke.kejasha.app.ui.shell.PropertyRoute
import ke.kejasha.app.ui.theme.LocalStatusColors
import ke.kejasha.app.ui.theme.StatusColors
import ke.kejasha.app.util.formatKes
import ke.kejasha.app.util.todayNairobi
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import org.maplibre.compose.camera.CameraPosition
import java.util.UUID
import javax.inject.Inject

/** What a unit tile means today (same states and colours as the web unit board). */
enum class TileState(val label: String) { OWING("Owing"), LET("Let"), VACANT("Vacant"), IN_HOUSE("Guest in"), BOOKED("Booked"), FREE("Free tonight"), BLOCKED("Blocked"), OFF("Inactive") }

data class Tile(val unit: KUnit, val state: TileState, val who: String?, val owesCents: Long)

data class PropertyBoard(val property: PropertyDetail, val tiles: List<Tile>)

/** Pure: today's state of each unit from the rent roll and the calendar (unit-tested). */
fun tilesFor(units: List<KUnit>, roll: List<RentRollItemsInner>, calendar: Map<UUID, List<CalendarEntry>>, today: String): List<Tile> {
    val byUnit = roll.associateBy { it.unitId }
    return units.map { u ->
        when {
            u.status != UnitStatus.ACTIVE -> Tile(u, TileState.OFF, null, 0)
            u.mode == UnitMode.LONG_TERM -> {
                val r = byUnit[u.id]
                val owes = r?.balanceCents ?: 0
                val state = if (r?.status == RentRollItemsInner.Status.OCCUPIED) (if (owes > 0) TileState.OWING else TileState.LET) else TileState.VACANT
                Tile(u, state, r?.tenantName, owes)
            }
            else -> {
                val e = calendar[u.id].orEmpty().firstOrNull { it.start <= today && it.end > today }
                when {
                    e == null -> Tile(u, TileState.FREE, null, 0)
                    e.kind != CalendarEntry.Kind.BOOKING -> Tile(u, TileState.BLOCKED, e.label, 0)
                    else -> Tile(u, if (e.status == BookingStatus.CHECKED_IN) TileState.IN_HOUSE else TileState.BOOKED, e.label, 0)
                }
            }
        }
    }
}

@HiltViewModel
class PropertyViewModel @Inject constructor(
    saved: SavedStateHandle,
    private val accounts: AccountsApi,
    private val reporting: ReportingApi,
    private val stays: ShortStayApi,
) : LoadViewModel<PropertyBoard>() {
    val id: UUID = UUID.fromString(saved.toRoute<PropertyRoute>().id)

    init { refresh() }

    override suspend fun load(): PropertyBoard = coroutineScope {
        val today = todayNairobi()
        val property = async { api { accounts.getProperty(id) } }
        val units = async { api { accounts.listUnits(limit = 100, propertyId = id) }.items }
        val roll = async { optional { api { reporting.getRentRoll(propertyId = id) }.items }.orEmpty() }
        val cal = async {
            optional { api { stays.getCalendar(today.toString(), today.plusDays(1).toString(), id) }.units }.orEmpty()
                .associate { it.unitId to it.propertyEntries }
        }
        PropertyBoard(property.await(), tilesFor(units.await(), roll.await(), cal.await(), today.toString()))
    }
}

/** A property: where it is and a board of every unit, by floor. */
@Composable
fun PropertyScreen(canEdit: Boolean, onSetLocation: (UUID) -> Unit, vm: PropertyViewModel = hiltViewModel()) =
    LoadableScreen(vm) { (p, tiles) ->
        Page {
            Text(p.name, style = MaterialTheme.typography.headlineSmall)
            Text(listOfNotNull(p.area, p.county.value).joinToString(", "), style = MaterialTheme.typography.bodyMedium)
            val at = p.latitude?.let { lat -> p.longitude?.let { LngLat(it, lat) } }
            if (at != null) {
                val state = rememberKejashaMapState(CameraPosition(center = at.position, zoom = 15.0))
                val pins = remember(at) { listOf(MapPin("p", at, PinColors.Brand, "", p.name, detail = listOfNotNull(p.area, p.county.value).joinToString(", ").ifEmpty { null })) }
                KejashaMap(state, pins, Modifier.fillMaxWidth().height(180.dp).clip(MaterialTheme.shapes.medium))
                if (canEdit) OutlinedButton(onClick = { onSetLocation(p.id) }) { Text("Move pin") }
            } else if (canEdit) {
                Button(onClick = { onSetLocation(p.id) }) {
                    Icon(Icons.Outlined.Place, contentDescription = null)
                    Text("Set location", Modifier.padding(start = 8.dp))
                }
            }
            SectionTitle("Units")
            UnitBoard(tiles)
        }
    }

private fun colors(s: TileState, c: StatusColors): Pair<Color, Color> = when (s) {
    TileState.OWING -> c.badSoft to c.bad
    TileState.LET -> c.goodSoft to c.good
    TileState.VACANT -> c.murramSoft to c.murram
    TileState.IN_HOUSE -> PinColors.Info to Color.White
    TileState.BOOKED -> c.infoSoft to c.info
    TileState.FREE -> Color.Transparent to c.info
    // Grey: ink falls back to the theme's on-surface-variant.
    TileState.BLOCKED, TileState.OFF -> Color(0x1F808080) to Color.Unspecified
}

/** Floors top-down like a building: higher numbers first, ground next, unnamed last. */
private fun floorRank(f: String): Double = f.toIntOrNull()?.let { -it.toDouble() } ?: if (Regex("^(g|ground)", RegexOption.IGNORE_CASE).containsMatchIn(f)) 0.5 else 1.0

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UnitBoard(tiles: List<Tile>) {
    if (tiles.isEmpty()) {
        Text("No units yet.", style = MaterialTheme.typography.bodyMedium)
        return
    }
    val c = LocalStatusColors.current
    // Legend with counts.
    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        tiles.groupingBy { it.state }.eachCount().toSortedMap().forEach { (s, n) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val (bg, fg) = colors(s, c)
                val swatch = RoundedCornerShape(3.dp)
                Box(
                    Modifier.size(12.dp)
                        .background(if (bg == Color.Transparent) MaterialTheme.colorScheme.surface else bg, swatch)
                        .border(1.dp, fg.takeOrElse(MaterialTheme.colorScheme.outline), swatch),
                )
                Text("${s.label} $n", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
    val floors = tiles.groupBy { it.unit.floor?.trim().orEmpty() }
    floors.keys.sortedWith { a, b -> if (a.isNotEmpty() && b.isNotEmpty()) floorRank(a).compareTo(floorRank(b)) else if (a.isNotEmpty()) -1 else 1 }.forEach { f ->
        if (f.isNotEmpty()) Text(if (f.all(Char::isDigit)) "Floor $f" else f, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            floors.getValue(f).sortedBy { it.unit.code }.forEach { t -> UnitTile(t, c) }
        }
    }
}

@Composable
private fun UnitTile(t: Tile, c: StatusColors) {
    val (bg, fg) = colors(t.state, c)
    val ink = fg.takeOrElse(MaterialTheme.colorScheme.onSurfaceVariant)
    val fill = if (bg == Color.Transparent) MaterialTheme.colorScheme.surface else bg
    Surface(
        color = fill,
        contentColor = ink,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier
            .width(104.dp)
            .border(1.dp, ink.copy(alpha = 0.35f), MaterialTheme.shapes.small)
            .semantics { contentDescription = "${t.unit.code}, ${t.state.label}" + (t.who?.let { ", $it" } ?: "") + if (t.owesCents > 0) ", owes ${formatKes(t.owesCents)}" else "" },
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(t.unit.code, fontWeight = FontWeight.Bold)
            Text(t.state.label, style = MaterialTheme.typography.labelSmall)
            (t.who ?: if (t.state == TileState.VACANT) t.unit.rentCents?.let { "Asking ${formatKes(it)}" } else null)?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
            if (t.owesCents > 0) Text("Owes ${formatKes(t.owesCents)}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun Color.takeOrElse(other: Color): Color = if (this == Color.Unspecified) other else this
