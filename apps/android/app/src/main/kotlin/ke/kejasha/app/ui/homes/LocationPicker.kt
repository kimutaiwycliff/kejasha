package ke.kejasha.app.ui.homes

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.toRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.AccountsApi
import ke.kejasha.api.models.PropertyDetail
import ke.kejasha.api.models.UpdatePropertyBodyInput
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.map.KENYA
import ke.kejasha.app.ui.map.KejashaMap
import ke.kejasha.app.ui.map.rememberKejashaMapState
import ke.kejasha.app.ui.shell.LocationRoute
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.maplibre.compose.camera.CameraPosition
import org.maplibre.spatialk.geojson.Position
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class LocationViewModel @Inject constructor(saved: SavedStateHandle, private val accounts: AccountsApi) : LoadViewModel<PropertyDetail>() {
    private val id = UUID.fromString(saved.toRoute<LocationRoute>().id)
    private val _saved = MutableStateFlow(false)
    val saved: StateFlow<Boolean> = _saved.asStateFlow()

    init { refresh() }

    override suspend fun load() = api { accounts.getProperty(id) }

    /** Six decimals ≈ 10 cm: plenty for a building, without float noise in the stored value. */
    fun save(at: Position) = act("Location saved", then = { _saved.value = true }) {
        fun d(x: Double) = BigDecimal(x).setScale(6, RoundingMode.HALF_UP).toDouble()
        api { accounts.updateProperty(id, UpdatePropertyBodyInput(latitude = d(at.latitude), longitude = d(at.longitude))) }
    }
}

/** Pan the map so the pin sits on the building, then save (no address lookup in v1: ADR-022). */
@Composable
fun LocationPickerScreen(onDone: () -> Unit, vm: LocationViewModel = hiltViewModel()) {
    val saved by vm.saved.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    LaunchedEffect(saved) { if (saved) onDone() }
    LoadableScreen(vm) { p ->
        val start = p.latitude?.let { lat -> p.longitude?.let { CameraPosition(center = Position(it, lat), zoom = 17.0) } }
            ?: KENYA
        val state = rememberKejashaMapState(start)
        Column(Modifier.fillMaxSize()) {
            Text(
                "Move the map until the pin is on ${p.name}.",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(16.dp),
            )
            Box(Modifier.weight(1f).fillMaxWidth()) {
                KejashaMap(state, emptyList(), Modifier.fillMaxSize())
                // The pin stays in the middle; its tip marks the spot.
                Icon(
                    Icons.Filled.Place,
                    contentDescription = null,
                    tint = Color(0xFFB44A25),
                    modifier = Modifier.align(Alignment.Center).offset(y = (-24).dp).size(48.dp),
                )
            }
            Button(
                onClick = { vm.save(state.cameraPosition.center) },
                enabled = !busy && state.cameraPosition.zoom >= 13,
                modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("save-location"),
            ) { Text(if (state.cameraPosition.zoom >= 13) "Save location" else "Zoom in to place the pin") }
        }
    }
}
