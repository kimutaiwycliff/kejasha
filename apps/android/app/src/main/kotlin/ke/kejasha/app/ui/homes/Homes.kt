package ke.kejasha.app.ui.homes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.AccountsApi
import ke.kejasha.api.endpoints.ReportingApi
import ke.kejasha.api.models.Property
import ke.kejasha.api.models.RentRollItemsInner
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.clickableRow
import ke.kejasha.app.ui.map.KejashaMap
import ke.kejasha.app.ui.map.LngLat
import ke.kejasha.app.ui.map.MapPin
import ke.kejasha.app.ui.map.framing
import ke.kejasha.app.ui.map.occupancyColor
import ke.kejasha.app.ui.map.rememberKejashaMapState
import ke.kejasha.app.ui.owner.optional
import ke.kejasha.app.ui.theme.LocalStatusColors
import java.util.UUID
import javax.inject.Inject

/** A property with how many of its long-term units are let today. */
data class Home(val property: Property, val occupied: Int, val longTerm: Int) {
    val at: LngLat? get() = property.latitude?.let { lat -> property.longitude?.let { LngLat(it, lat) } }
}

@HiltViewModel
class HomesViewModel @Inject constructor(
    private val accounts: AccountsApi,
    private val reporting: ReportingApi,
) : LoadViewModel<List<Home>>() {
    init { refresh() }

    override suspend fun load(): List<Home> {
        val props = api { accounts.listProperties(limit = 100) }.items
        // Roles that may not read the rent roll still see their properties.
        val roll: List<RentRollItemsInner> = optional { api { reporting.getRentRoll() }.items }.orEmpty()
        val byName = roll.groupBy { it.propertyName }
        return props.map { p ->
            val units = byName[p.name].orEmpty()
            Home(p, units.count { it.status == RentRollItemsInner.Status.OCCUPIED }, units.size)
        }
    }
}

/** Every property as a list or on a map; tap one for its unit board. */
@Composable
fun HomesScreen(onProperty: (UUID) -> Unit, vm: HomesViewModel = hiltViewModel()) {
    var view by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            listOf("List" to Icons.AutoMirrored.Outlined.List, "Map" to Icons.Outlined.Map).forEachIndexed { i, (label, icon) ->
                SegmentedButton(
                    selected = view == i,
                    onClick = { view = i },
                    shape = SegmentedButtonDefaults.itemShape(i, 2),
                    icon = { Icon(icon, contentDescription = null) },
                ) { Text(label) }
            }
        }
        LoadableScreen(vm) { homes ->
            // A plain switch: the map surface needs its final size from the first frame.
            if (view == 0) HomeList(homes, onProperty) else HomeMap(homes, onProperty)
        }
    }
}

@Composable
private fun HomeList(homes: List<Home>, onProperty: (UUID) -> Unit) {
    if (homes.isEmpty()) {
        Column(Modifier.padding(16.dp)) { Empty("No properties yet. Add them on the web app.") }
        return
    }
    val status = LocalStatusColors.current
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        itemsIndexed(homes, key = { _, h -> h.property.id }) { i, h ->
            Card(Modifier.fillMaxWidth().animateItem().clickableRow { onProperty(h.property.id) }) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(h.property.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        if (h.at == null) Icon(Icons.Outlined.Place, contentDescription = "Not on the map yet", tint = status.murram)
                    }
                    Text(listOfNotNull(h.property.area, h.property.county.value).joinToString(", "), style = MaterialTheme.typography.bodySmall)
                    val c = h.property.unitCounts
                    Text("${c.total} units" + (if (c.shortStay > 0) " · ${c.shortStay} short-stay" else ""))
                    if (h.longTerm > 0) {
                        LinearProgressIndicator(
                            progress = { h.occupied / h.longTerm.toFloat() },
                            color = occupancyColor(h.occupied, h.longTerm),
                            modifier = Modifier.fillMaxWidth().height(6.dp),
                        )
                        Text("${h.occupied} of ${h.longTerm} long-term units let", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeMap(homes: List<Home>, onProperty: (UUID) -> Unit) {
    val placed = homes.filter { it.at != null }
    val pins = remember(homes) {
        placed.map { h ->
            MapPin(
                id = h.property.id.toString(),
                at = h.at!!,
                color = occupancyColor(h.occupied, h.longTerm),
                label = if (h.longTerm > 0) "${h.occupied}/${h.longTerm}" else "${h.property.unitCounts.total}",
                description = "${h.property.name}: ${h.occupied} of ${h.longTerm} long-term units let. Opens the property.",
            )
        }
    }
    val state = rememberKejashaMapState(framing(placed.map { it.at!! }))
    Column(Modifier.fillMaxSize()) {
        if (placed.size < homes.size) {
            Text(
                "${homes.size - placed.size} not on the map yet — open one and set its location.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        KejashaMap(state, pins, Modifier.fillMaxSize(), onPin = { onProperty(UUID.fromString(it)) })
    }
}
