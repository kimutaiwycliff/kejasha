package ke.kejasha.app.ui.caretaker

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.app.data.db.OutboxDao
import ke.kejasha.app.data.db.OutboxEntity
import ke.kejasha.app.data.db.SyncStateDao
import ke.kejasha.app.data.db.SyncStateEntity
import ke.kejasha.app.data.sync.CaretakerRepository
import ke.kejasha.app.data.sync.SyncEngine
import ke.kejasha.app.data.sync.SyncScheduler
import ke.kejasha.app.session.SessionRepository
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.Row2
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.util.NAIROBI
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject

data class SyncUi(val state: SyncStateEntity?, val pending: Int, val dead: List<OutboxEntity>, val running: Boolean)

@HiltViewModel
class SyncViewModel @Inject constructor(
    session: SessionRepository,
    outbox: OutboxDao,
    syncState: SyncStateDao,
    engine: SyncEngine,
    private val scheduler: SyncScheduler,
    private val repo: CaretakerRepository,
) : ViewModel() {
    private val orgId = session.activeOrgId

    val ui: StateFlow<SyncUi?> = if (orgId == null) {
        flowOf(null).stateIn(viewModelScope, SharingStarted.Eagerly, null)
    } else {
        combine(syncState.observe(orgId), outbox.pendingCount(orgId), outbox.dead(orgId), engine.running) { s, p, d, r -> SyncUi(s, p, d, r) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    }

    fun syncNow() = scheduler.now()
    fun discard(id: String) = viewModelScope.launch { repo.discard(id) }

}

private val time = DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale.ENGLISH)

private val TYPE_LABEL = mapOf(
    SyncEngine.TICKET to "Repair reported",
    SyncEngine.TICKET_UPDATE to "Repair update",
    SyncEngine.METER_READING to "Meter reading",
    SyncEngine.CASH to "Cash logged",
)

/** What has reached Kejasha, what is waiting, and what was refused (with the reason). */
@Composable
fun SyncScreen(vm: SyncViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val u = ui ?: return
    Page {
        if (u.running) LinearProgressIndicator(Modifier.fillMaxWidth())
        Row2("Last synced", u.state?.lastSyncedAt?.let { Instant.ofEpochMilli(it).atZone(NAIROBI).format(time) } ?: "Never")
        Row2("Waiting to send", u.pending.toString())
        if (u.pending == 0 && u.state?.lastSyncedAt != null && !u.running) Text("Nothing waiting to send.", modifier = Modifier.testTag("all-sent"))
        u.state?.lastError?.let { Text("Last attempt: $it", color = MaterialTheme.colorScheme.error) }
        Button(onClick = vm::syncNow, enabled = !u.running, modifier = Modifier.fillMaxWidth().testTag("sync-now")) { Text("Sync now") }
        Text("Changes are sent automatically when the phone is online.", style = MaterialTheme.typography.bodySmall)
        SectionTitle("Not accepted")
        if (u.dead.isEmpty()) Empty("Nothing was refused.")
        u.dead.forEach { e ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(TYPE_LABEL[e.type] ?: e.type, style = MaterialTheme.typography.titleMedium)
                    Text(e.error ?: e.errorCode ?: "Refused by Kejasha")
                    OutlinedButton(onClick = { vm.discard(e.id) }) { Text("Discard") }
                }
            }
        }
    }
}
