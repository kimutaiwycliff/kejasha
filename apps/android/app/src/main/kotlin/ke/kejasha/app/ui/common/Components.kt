package ke.kejasha.app.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ke.kejasha.app.ui.Centered

/** The shell's snackbar, so screens can report action outcomes. */
val LocalSnackbar = compositionLocalOf { SnackbarHostState() }

/**
 * Loading, error and pull-to-refresh around a [LoadViewModel]'s data. Action messages go to the
 * shell's snackbar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> LoadableScreen(vm: LoadViewModel<T>, content: @Composable (T) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = LocalSnackbar.current
    LaunchedEffect(message) {
        message?.let { snackbar.showSnackbar(it); vm.messageShown() }
    }
    when (val s = state) {
        Loadable.Loading -> Centered { CircularProgressIndicator() }
        is Loadable.Failed -> Centered {
            Text(s.message, textAlign = TextAlign.Center)
            Button(onClick = vm::refresh) { Text("Try again") }
        }
        is Loadable.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
            content(s.data)
        }
    }
}

/** A scrolling column with page padding (inside [LoadableScreen], so pull-to-refresh works). */
@Composable
fun Page(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
fun SectionTitle(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))

@Composable
fun Empty(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

/** A labelled figure: "Collected" over "Ksh 120,000.00". */
@Composable
fun Stat(label: String, value: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val body: @Composable ColumnScope.() -> Unit = {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleLarge)
    }
    if (onClick != null) {
        Card(onClick = onClick, modifier = modifier) { Column(Modifier.padding(16.dp).fillMaxWidth(), content = body) }
    } else {
        Card(modifier = modifier) { Column(Modifier.padding(16.dp).fillMaxWidth(), content = body) }
    }
}

/** A small coloured label for a status. */
@Composable
fun StatusChip(text: String, tone: Tone = Tone.NEUTRAL) {
    val (bg, fg) = when (tone) {
        Tone.GOOD -> Color(0xFF047857) to Color.White
        Tone.WARN -> Color(0xFFB45309) to Color.White
        Tone.BAD -> Color(0xFFB91C1C) to Color.White
        Tone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = bg, contentColor = fg, shape = MaterialTheme.shapes.small) {
        Text(text, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

enum class Tone { GOOD, WARN, BAD, NEUTRAL }

/** A label and value on one line. */
@Composable
fun Row2(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, textAlign = TextAlign.End, modifier = Modifier.padding(start = 16.dp))
    }
}

/** Ask for a required reason (reject, ignore, cancel). */
@Composable
fun ReasonDialog(title: String, confirmLabel: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var reason by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it.take(500) },
                label = { Text("Reason") },
                modifier = Modifier.fillMaxWidth().testTag("reason"),
            )
        },
        confirmButton = { TextButton(onClick = { onConfirm(reason.trim()) }, enabled = reason.isNotBlank()) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Back") } },
    )
}

/** Confirm a step that changes money or status. */
@Composable
fun ConfirmDialog(title: String, text: String, confirmLabel: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Back") } },
    )
}

/** A shilling amount field; the caller parses with `parseKes`. */
@Composable
fun MoneyField(label: String, value: String, onChange: (String) -> Unit, tag: String, modifier: Modifier = Modifier, error: String? = null) {
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(16)) },
        label = { Text(label) },
        prefix = { Text("Ksh ") },
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = modifier.fillMaxWidth().testTag(tag),
    )
}
