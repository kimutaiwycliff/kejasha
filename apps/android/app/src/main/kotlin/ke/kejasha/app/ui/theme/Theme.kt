package ke.kejasha.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ke.kejasha.app.R

// Kejasha brand (docs/plans/phase-d.md, ADR-022): the same palette and status colours as the web.

private val Light = lightColorScheme(
    primary = Color(0xFF0F6B52),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD5EBE1),
    onPrimaryContainer = Color(0xFF0B3D30),
    secondary = Color(0xFFB44A25),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFBECE5),
    onSecondaryContainer = Color(0xFF6E2A12),
    tertiary = Color(0xFF1F6FB2),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE8F1FA),
    onTertiaryContainer = Color(0xFF1E5A8F),
    error = Color(0xFFB91C1C),
    errorContainer = Color(0xFFFDECEC),
    onErrorContainer = Color(0xFF7F1D1D),
    background = Color(0xFFFAF8F4),
    onBackground = Color(0xFF1C1917),
    surface = Color(0xFFFAF8F4),
    onSurface = Color(0xFF1C1917),
    surfaceVariant = Color(0xFFF2EFE9),
    onSurfaceVariant = Color(0xFF57534E),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF5F2EC),
    surfaceContainerHigh = Color(0xFFF0EDE6),
    surfaceContainerHighest = Color(0xFFEAE6DE),
    outline = Color(0xFFCFC8BC),
    outlineVariant = Color(0xFFE7E2D9),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF3DBE8F),
    onPrimary = Color(0xFF06231A),
    primaryContainer = Color(0xFF15362B),
    onPrimaryContainer = Color(0xFFCDEEDF),
    secondary = Color(0xFFE58A62),
    onSecondary = Color(0xFF2A120A),
    secondaryContainer = Color(0xFF3A2117),
    onSecondaryContainer = Color(0xFFF7D3C2),
    tertiary = Color(0xFF6AAEE6),
    onTertiary = Color(0xFF07243D),
    tertiaryContainer = Color(0xFF10243A),
    onTertiaryContainer = Color(0xFFA9D1F5),
    error = Color(0xFFF87171),
    errorContainer = Color(0xFF3A1414),
    onErrorContainer = Color(0xFFFECACA),
    background = Color(0xFF0D1311),
    onBackground = Color(0xFFECEAE4),
    surface = Color(0xFF0D1311),
    onSurface = Color(0xFFECEAE4),
    surfaceVariant = Color(0xFF1A221F),
    onSurfaceVariant = Color(0xFFA8A29E),
    surfaceContainerLowest = Color(0xFF0A0F0D),
    surfaceContainerLow = Color(0xFF141C19),
    surfaceContainer = Color(0xFF17201C),
    surfaceContainerHigh = Color(0xFF1B2521),
    surfaceContainerHighest = Color(0xFF222D28),
    outline = Color(0xFF4A524E),
    outlineVariant = Color(0xFF26302C),
)

/** Status colours: the same meaning on every screen (occupied, due soon, booked, owing…). */
@Immutable
data class StatusColors(
    val good: Color, val goodSoft: Color,
    val warn: Color, val warnSoft: Color,
    val info: Color, val infoSoft: Color,
    val bad: Color, val badSoft: Color,
    val murram: Color, val murramSoft: Color,
    /** The forest green of the brand panel (headers, hero cards). */
    val forest: Color,
)

private val LightStatus = StatusColors(
    good = Color(0xFF166534), goodSoft = Color(0xFFE7F4EC),
    warn = Color(0xFF92400E), warnSoft = Color(0xFFFDF3E1),
    info = Color(0xFF1E5A8F), infoSoft = Color(0xFFE8F1FA),
    bad = Color(0xFFB91C1C), badSoft = Color(0xFFFDECEC),
    murram = Color(0xFFB44A25), murramSoft = Color(0xFFFBECE5),
    forest = Color(0xFF0B3D30),
)

private val DarkStatus = StatusColors(
    good = Color(0xFF86EFAC), goodSoft = Color(0xFF11291B),
    warn = Color(0xFFFCD9A8), warnSoft = Color(0xFF3A2A12),
    info = Color(0xFFA9D1F5), infoSoft = Color(0xFF10243A),
    bad = Color(0xFFFECACA), badSoft = Color(0xFF3A1414),
    murram = Color(0xFFE58A62), murramSoft = Color(0xFF3A2117),
    forest = Color(0xFF0A1A15),
)

val LocalStatusColors = staticCompositionLocalOf { LightStatus }

/** Plus Jakarta Sans (SIL OFL, `third_party/OFL-PlusJakartaSans.txt`), one variable font file. */
private fun jakarta(weight: FontWeight) = Font(
    R.font.plus_jakarta_sans,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

val Jakarta = FontFamily(
    listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold, FontWeight.ExtraBold).map(::jakarta),
)

private val typography = Typography().let { t ->
    fun TextStyle.j(weight: FontWeight? = null) = copy(fontFamily = Jakarta, fontWeight = weight ?: fontWeight)
    Typography(
        displayLarge = t.displayLarge.j(FontWeight.ExtraBold),
        displayMedium = t.displayMedium.j(FontWeight.ExtraBold),
        displaySmall = t.displaySmall.j(FontWeight.Bold),
        headlineLarge = t.headlineLarge.j(FontWeight.ExtraBold),
        headlineMedium = t.headlineMedium.j(FontWeight.Bold),
        headlineSmall = t.headlineSmall.j(FontWeight.Bold),
        titleLarge = t.titleLarge.j(FontWeight.Bold),
        titleMedium = t.titleMedium.j(FontWeight.SemiBold),
        titleSmall = t.titleSmall.j(FontWeight.SemiBold),
        bodyLarge = t.bodyLarge.j(),
        bodyMedium = t.bodyMedium.j(),
        bodySmall = t.bodySmall.j(),
        labelLarge = t.labelLarge.j(FontWeight.SemiBold),
        labelMedium = t.labelMedium.j(FontWeight.SemiBold),
        labelSmall = t.labelSmall.j(FontWeight.Medium),
    )
}

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun KejashaTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalStatusColors provides if (dark) DarkStatus else LightStatus) {
        MaterialTheme(colorScheme = if (dark) Dark else Light, typography = typography, shapes = shapes, content = content)
    }
}
