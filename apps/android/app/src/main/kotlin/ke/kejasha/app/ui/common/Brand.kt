package ke.kejasha.app.ui.common

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ke.kejasha.app.R

val Acacia = Color(0xFF0F6B52)
val MurramLight = Color(0xFFE8875F)

/** The Kejasha mark (the launcher icon's foreground on its acacia tile). */
@Composable
fun KejashaMark(size: Dp = 32.dp) {
    Box(Modifier.size(size).background(Acacia, RoundedCornerShape(size / 4)), contentAlignment = Alignment.Center) {
        Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.size(size * 2.1f))
    }
}

/** Mark + "keja" (home) "sha" in the brand accent; read as "Kejasha". */
@Composable
fun KejashaLogo(inverse: Boolean = false, size: Dp = 32.dp) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.clearAndSetSemantics { contentDescription = "Kejasha" },
    ) {
        KejashaMark(size)
        Text(
            buildAnnotatedString {
                append("keja")
                withStyle(SpanStyle(color = if (inverse) MurramLight else MaterialTheme.colorScheme.secondary)) { append("sha") }
            },
            style = MaterialTheme.typography.headlineSmall.copy(fontSize = (size.value * 0.7f).sp),
            color = if (inverse) Color.White else MaterialTheme.colorScheme.onBackground,
        )
    }
}
