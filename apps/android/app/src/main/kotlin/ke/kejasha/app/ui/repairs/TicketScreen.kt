package ke.kejasha.app.ui.repairs

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.toRoute
import coil3.compose.AsyncImage
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import ke.kejasha.api.endpoints.MaintenanceApi
import ke.kejasha.api.models.AddTicketUpdateBodyInput
import ke.kejasha.api.models.TicketDetail
import ke.kejasha.api.models.TicketStatus
import ke.kejasha.api.models.TicketStatusInput
import ke.kejasha.api.models.UploadRequestInput
import ke.kejasha.app.net.Uploader
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.MoneyField
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.PhotoButtons
import ke.kejasha.app.ui.common.Row2
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.compressPhoto
import ke.kejasha.app.ui.common.label
import ke.kejasha.app.ui.common.tone
import ke.kejasha.app.ui.shell.TicketRoute
import ke.kejasha.app.util.formatDateTime
import ke.kejasha.app.util.formatKes
import ke.kejasha.app.util.parseKes
import java.util.UUID
import javax.inject.Inject

/** The next step for a repair: open → in progress → resolved (with the cost) → closed. */
enum class TicketStep(val label: String, val to: TicketStatusInput, val asksCost: Boolean = false) {
    START("Start work", TicketStatusInput.IN_PROGRESS),
    RESOLVE("Mark resolved", TicketStatusInput.RESOLVED, asksCost = true),
    CLOSE("Close ticket", TicketStatusInput.CLOSED),
    ;

    companion object {
        fun after(status: TicketStatus): TicketStep? = when (status) {
            TicketStatus.OPEN -> START
            TicketStatus.IN_PROGRESS -> RESOLVE
            TicketStatus.RESOLVED -> CLOSE
            TicketStatus.CLOSED, TicketStatus.CANCELLED -> null
        }
    }
}

@HiltViewModel
class TicketViewModel @Inject constructor(
    saved: SavedStateHandle,
    @param:ApplicationContext private val context: Context,
    private val maintenance: MaintenanceApi,
    private val uploader: Uploader,
) : LoadViewModel<TicketDetail>() {
    private val id = UUID.fromString(saved.toRoute<TicketRoute>().id)

    init { refresh() }

    override suspend fun load() = api { maintenance.getTicket(id) }

    /** A note, photos, a status step (with cost when resolving), or any mix; photos upload first. */
    fun update(note: String, photos: List<Uri>, step: TicketStep?, costCents: Long?, done: () -> Unit) =
        act(step?.let { "Ticket: ${it.label.lowercase()}" } ?: "Update added", then = done) {
            val keys = photos.map { uploader.upload(UploadRequestInput.Purpose.MAINTENANCE_PHOTO, compressPhoto(context, it)) }
            val body = AddTicketUpdateBodyInput(
                note = note.trim().ifEmpty { null },
                status = step?.to,
                costCents = costCents,
                photoKeys = keys.ifEmpty { null },
            )
            api { maintenance.addTicketUpdate(id, body) }
        }
}

@Composable
fun TicketScreen(vm: TicketViewModel = hiltViewModel()) {
    val busy by vm.busy.collectAsStateWithLifecycle()
    var note by rememberSaveable { mutableStateOf("") }
    var cost by rememberSaveable { mutableStateOf("") }
    var stepping by rememberSaveable { mutableStateOf(false) }
    val photos = remember { mutableStateListOf<Uri>() }
    LoadableScreen(vm) { t ->
        val step = TicketStep.after(t.status)
        Page {
            Text(t.title, style = MaterialTheme.typography.headlineSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(t.status.label, t.status.tone)
                StatusChip(t.priority.label)
                StatusChip(t.category.label)
            }
            Row2("Ticket", t.number)
            Row2("Where", listOfNotNull(t.unitCode, t.propertyName).joinToString(" · "))
            Row2("Reported", formatDateTime(t.createdAt))
            t.assigneeName?.let { Row2("Assigned to", it) }
            t.costCents?.let { Row2("Cost", formatKes(it)) }
            t.description?.let { Text(it) }

            if (step != null) {
                SectionTitle("Add an update")
                OutlinedTextField(note, { note = it.take(2000) }, label = { Text("Note") }, minLines = 2, modifier = Modifier.fillMaxWidth().testTag("note"))
                PhotoButtons(onPicked = { if (photos.size < 6) photos += it }, enabled = !busy)
                if (photos.isNotEmpty()) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        photos.forEachIndexed { i, uri ->
                            Column {
                                AsyncImage(model = uri, contentDescription = "Photo ${i + 1}", contentScale = ContentScale.Crop, modifier = Modifier.size(88.dp))
                                TextButton(onClick = { photos.removeAt(i) }) { Text("Remove") }
                            }
                        }
                    }
                }
                if (stepping && step.asksCost) {
                    MoneyField("Final cost (optional)", cost, { cost = it }, tag = "cost", error = if (cost.isNotEmpty() && parseKes(cost) == null) "Enter an amount in shillings" else null)
                }
                val reset = { note = ""; cost = ""; stepping = false; photos.clear() }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            if (step.asksCost && !stepping) stepping = true
                            else vm.update(note, photos.toList(), step, parseKes(cost), reset)
                        },
                        enabled = !busy && (cost.isEmpty() || parseKes(cost) != null),
                    ) { Text(step.label) }
                    OutlinedButton(
                        onClick = { vm.update(note, photos.toList(), null, null, reset) },
                        enabled = !busy && (note.isNotBlank() || photos.isNotEmpty()),
                    ) { Text("Add note") }
                }
            }

            SectionTitle("History")
            t.updates.sortedByDescending { it.createdAt }.forEach { u ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(formatDateTime(u.createdAt), style = MaterialTheme.typography.labelMedium)
                        u.statusTo?.let { to -> Text("${u.statusFrom?.label ?: "New"} → ${to.label}") }
                        u.note?.let { Text(it) }
                        if (u.photos.isNotEmpty()) {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                u.photos.filter { it.url.isNotEmpty() }.forEachIndexed { i, p ->
                                    AsyncImage(model = p.url, contentDescription = "Update photo ${i + 1}", contentScale = ContentScale.Crop, modifier = Modifier.size(96.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
