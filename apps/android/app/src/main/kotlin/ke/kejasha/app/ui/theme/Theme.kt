package ke.kejasha.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Neutral like the web app's design system; emerald accents for money in.
private val Light = lightColorScheme(
    primary = Color(0xFF171717),
    onPrimary = Color(0xFFFAFAFA),
    secondary = Color(0xFF047857),
    onSecondary = Color.White,
    error = Color(0xFFB91C1C),
    background = Color.White,
    surface = Color.White,
)

private val Dark = darkColorScheme(
    primary = Color(0xFFE5E5E5),
    onPrimary = Color(0xFF171717),
    secondary = Color(0xFF6EE7B7),
    onSecondary = Color(0xFF052E16),
    error = Color(0xFFFCA5A5),
    background = Color(0xFF0A0A0A),
    surface = Color(0xFF0A0A0A),
)

@Composable
fun KejashaTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}
