package ke.kejasha.app.ui.caretaker

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import java.io.File

/** Photos waiting to be sent, each removable. */
@Composable
fun PhotoStrip(photos: List<File>, onRemove: (Int) -> Unit) {
    if (photos.isEmpty()) return
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        photos.forEachIndexed { i, file ->
            Column {
                AsyncImage(model = file, contentDescription = "Photo ${i + 1}", contentScale = ContentScale.Crop, modifier = Modifier.size(88.dp))
                TextButton(onClick = { onRemove(i) }) { Text("Remove") }
            }
        }
    }
}
