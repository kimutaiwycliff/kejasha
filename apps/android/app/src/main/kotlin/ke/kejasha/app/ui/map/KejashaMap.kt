package ke.kejasha.app.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import ke.kejasha.app.BuildConfig
import org.maplibre.compose.camera.CameraPosition
import org.maplibre.compose.map.MaplibreMap
import org.maplibre.compose.map.MapState
import org.maplibre.compose.map.rememberMapState
import org.maplibre.compose.overlay.MapOverlay
import org.maplibre.compose.overlay.include
import org.maplibre.compose.style.BaseStyle
import org.maplibre.spatialk.geojson.Position

import kotlin.math.ln
import kotlin.math.max

/** A point on the map: longitude then latitude, as GeoJSON orders them. */
data class LngLat(val lng: Double, val lat: Double) {
    val position: Position get() = Position(lng, lat)
}

data class MapPin(val id: String, val at: LngLat, val color: Color, val label: String, val description: String)

/** Kenya as a whole, for owners whose properties are not pinned yet. */
val KENYA = CameraPosition(center = Position(37.9, 0.2), zoom = 5.4)

/** A camera that frames every pin (approximate, plenty for a portfolio). */
fun framing(pins: List<LngLat>): CameraPosition {
    if (pins.isEmpty()) return KENYA
    val lng = (pins.minOf { it.lng } + pins.maxOf { it.lng }) / 2
    val lat = (pins.minOf { it.lat } + pins.maxOf { it.lat }) / 2
    val span = max(pins.maxOf { it.lng } - pins.minOf { it.lng }, pins.maxOf { it.lat } - pins.minOf { it.lat })
    val zoom = if (span < 1e-4) 15.0 else (ln(360.0 / span) / ln(2.0) - 1.2).coerceIn(5.0, 15.0)
    return CameraPosition(center = Position(lng, lat), zoom = zoom)
}

/** The map style is configuration (ADR-022): OpenFreeMap unless the build points elsewhere. */
@Composable
fun rememberKejashaMapState(camera: CameraPosition): MapState =
    rememberMapState(baseStyle = BaseStyle.Uri(BuildConfig.MAP_STYLE_URL), initialCameraPosition = camera)

/**
 * MapLibre with Kejasha pins: each pin is a composable placed at its coordinates, so it is
 * focusable and read by TalkBack ([MapPin.description]). Attribution stays on.
 */
@Composable
fun KejashaMap(
    state: MapState,
    pins: List<MapPin>,
    modifier: Modifier = Modifier,
    onPin: (String) -> Unit = {},
    extra: @Composable () -> Unit = {},
) {
    MaplibreMap(modifier = modifier, state = state, overlay = {
        include(MapOverlay.Default)
        pins.forEach { pin ->
            Box(
                Modifier
                    .placedAt(pin.at.position, Alignment.Center)
                    .shadow(4.dp, CircleShape)
                    .defaultMinSize(minWidth = 32.dp, minHeight = 32.dp)
                    .background(pin.color, CircleShape)
                    .border(2.dp, Color.White, CircleShape)
                    .clickable(role = Role.Button) { onPin(pin.id) }
                    .semantics { contentDescription = pin.description; role = Role.Button },
                contentAlignment = Alignment.Center,
            ) {
                Text(pin.label, color = Color.White, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp))
            }
        }
        extra()
    })
}

/** Pin colours: fixed in both themes so white pin text stays readable (≥ 4.5:1). */
object PinColors {
    val Good = Color(0xFF16803C)
    val Warn = Color(0xFFB45309)
    val Low = Color(0xFFB44A25)
    val Info = Color(0xFF1F6FB2)
    val Brand = Color(0xFF0F6B52)
}

/** Occupancy → pin colour (same meaning as the web map and status chips). */
fun occupancyColor(occupied: Int, units: Int): Color = when {
    units == 0 -> PinColors.Info
    occupied * 10 >= units * 9 -> PinColors.Good
    occupied * 10 >= units * 6 -> PinColors.Warn
    else -> PinColors.Low
}

