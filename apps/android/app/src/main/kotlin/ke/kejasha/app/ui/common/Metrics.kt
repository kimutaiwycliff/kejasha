package ke.kejasha.app.ui.common

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ke.kejasha.app.ui.theme.LocalStatusColors

/**
 * A number that counts up to [value] when it appears (~600 ms, ease-out). Exact at the end; the
 * system animator scale (including "animations off") applies. TalkBack reads only the final value.
 */
@Composable
fun CountUp(value: Long, format: (Long) -> String, style: androidx.compose.ui.text.TextStyle) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(value) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(600, easing = FastOutSlowInEasing))
    }
    val shown = if (progress.value >= 1f) value else (value * progress.value).toLong()
    Text(format(shown), style = style, modifier = Modifier.clearAndSetSemantics { contentDescription = format(value) })
}

/** A headline figure with a coloured icon chip (tones as everywhere: good, warn, bad, info, murram). */
@Composable
fun MetricCard(
    label: String,
    value: Long,
    format: (Long) -> String,
    icon: ImageVector,
    tone: Tone,
    modifier: Modifier = Modifier,
    hint: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val c = LocalStatusColors.current
    val (bg, fg) = when (tone) {
        Tone.GOOD -> c.goodSoft to c.good
        Tone.WARN -> c.warnSoft to c.warn
        Tone.BAD -> c.badSoft to c.bad
        Tone.INFO -> c.infoSoft to c.info
        Tone.MURRAM -> c.murramSoft to c.murram
        Tone.NEUTRAL -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.primary
    }
    val content: @Composable () -> Unit = {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                Box(Modifier.size(34.dp).background(bg, MaterialTheme.shapes.small), contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
                }
            }
            CountUp(value, format, MaterialTheme.typography.titleLarge)
            hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
    if (onClick != null) Card(onClick = onClick, modifier = modifier) { content() } else Card(modifier) { content() }
}

/** Paired monthly bars that grow in (collected vs expenses); TalkBack gets a summary. */
@Composable
fun PairedBars(months: List<Triple<String, Long, Long>>, aLabel: String, bLabel: String, a: Color, b: Color, summary: String) {
    val grow = remember { Animatable(0f) }
    LaunchedEffect(months) { grow.snapTo(0f); grow.animateTo(1f, tween(700, easing = FastOutSlowInEasing)) }
    val max = (months.maxOfOrNull { maxOf(it.second, it.third) } ?: 0L).coerceAtLeast(1L).toFloat()
    Column(Modifier.semantics { contentDescription = summary }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            listOf(aLabel to a, bLabel to b).forEach { (l, col) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(10.dp).background(col, MaterialTheme.shapes.extraSmall))
                    Text(l, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        Canvas(Modifier.fillMaxWidth().height(140.dp)) {
            val slot = size.width / months.size.coerceAtLeast(1)
            val bar = (slot / 3.2f).coerceAtMost(28.dp.toPx())
            months.forEachIndexed { i, (_, va, vb) ->
                val x = i * slot + slot / 2
                listOf(Triple(va, a, x - bar - 2.dp.toPx()), Triple(vb, b, x + 2.dp.toPx())).forEach { (v, col, left) ->
                    val h = (v / max) * size.height * grow.value
                    drawRoundRect(col, Offset(left, size.height - h), Size(bar, h.coerceAtLeast(2f)), CornerRadius(6.dp.toPx()))
                }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            months.forEach { (m, _, _) ->
                Text(m, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}
