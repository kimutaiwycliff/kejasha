package ke.kejasha.app.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.clickable

/** A labelled choice from a short list (property, unit, category). */
@Composable
fun <T> Picker(label: String, options: List<Pair<T, String>>, selected: T?, onSelect: (T) -> Unit, tag: String, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val text = options.firstOrNull { it.first == selected }?.second.orEmpty()
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = text,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { Icon(Icons.Outlined.ArrowDropDown, contentDescription = null) },
            modifier = Modifier.fillMaxWidth(),
        )
        // The read-only field does not take taps; this layer opens the list.
        Box(
            Modifier.matchParentSize().testTag(tag).semantics {
                role = Role.DropdownList
                contentDescription = "$label: ${text.ifEmpty { "not chosen" }}"
            }.clickable { open = true },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, name) ->
                DropdownMenuItem(text = { Text(name) }, onClick = { onSelect(value); open = false })
            }
        }
    }
}
