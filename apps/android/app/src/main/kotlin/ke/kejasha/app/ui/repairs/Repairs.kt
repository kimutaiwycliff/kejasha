package ke.kejasha.app.ui.repairs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.MaintenanceApi
import ke.kejasha.api.models.Ticket
import ke.kejasha.api.models.TicketPriority
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.ui.common.clickableRow
import ke.kejasha.app.ui.common.label
import ke.kejasha.app.ui.common.tone
import ke.kejasha.app.util.formatDate
import java.util.UUID
import javax.inject.Inject
import ke.kejasha.api.endpoints.MaintenanceApi.ActiveListTickets

@HiltViewModel
class RepairsViewModel @Inject constructor(private val maintenance: MaintenanceApi) : LoadViewModel<List<Ticket>>() {
    init { refresh() }

    /** Open and in-progress repairs, the most urgent first. */
    override suspend fun load(): List<Ticket> =
        api { maintenance.listTickets(limit = 100, active = ActiveListTickets.TRUE) }.items
            .sortedWith(compareByDescending<Ticket> { it.priority.ordinal }.thenBy { it.createdAt })
}

@Composable
fun RepairsScreen(onTicket: (UUID) -> Unit, vm: RepairsViewModel = hiltViewModel()) = LoadableScreen(vm) { tickets ->
    Page {
        if (tickets.isEmpty()) Empty("No open repairs.")
        tickets.forEach { t ->
            ListItem(
                headlineContent = { Text("${t.number} · ${t.title}") },
                supportingContent = { Text(listOfNotNull(t.unitCode, t.propertyName, "reported ${formatDate(t.createdAt)}").joinToString(" · ")) },
                trailingContent = {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (t.priority >= TicketPriority.HIGH) StatusChip(t.priority.label, Tone.BAD)
                        StatusChip(t.status.label, t.status.tone)
                    }
                },
                modifier = Modifier.clickableRow { onTicket(t.id) },
            )
        }
    }
}
