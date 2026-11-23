package ke.kejasha.app.ui.owner

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.ShortStayApi
import ke.kejasha.api.models.Booking
import ke.kejasha.api.models.BookingStatus
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.ConfirmDialog
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.ui.common.label
import ke.kejasha.app.util.formatDate
import ke.kejasha.app.util.formatKes
import ke.kejasha.app.util.todayNairobi
import java.util.UUID
import javax.inject.Inject

/** Guests in house now and arrivals over the next 30 days. */
data class Stays(val today: String, val inHouse: List<Booking>, val upcoming: List<Booking>)

@HiltViewModel
class StaysViewModel @Inject constructor(private val stays: ShortStayApi) : LoadViewModel<Stays>() {
    init { refresh() }

    override suspend fun load(): Stays {
        val today = todayNairobi()
        val items = api {
            stays.listBookings(limit = 100, from = today.minusDays(1).toString(), to = today.plusDays(30).toString())
        }.items
        return Stays(
            today = today.toString(),
            inHouse = items.filter { it.status == BookingStatus.CHECKED_IN }.sortedBy { it.checkOut },
            upcoming = items.filter { it.status == BookingStatus.CONFIRMED }.sortedBy { it.checkIn },
        )
    }

    fun checkIn(b: Booking) = act("${b.guestName ?: "Guest"} checked in") { api { stays.checkInBooking(b.id) } }
    fun checkOut(b: Booking) = act("${b.guestName ?: "Guest"} checked out") { api { stays.checkOutBooking(b.id) } }
}

@Composable
fun StaysScreen(onRequestPayment: (UUID) -> Unit, vm: StaysViewModel = hiltViewModel()) {
    val busy by vm.busy.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf<Pair<Booking, Boolean>?>(null) }
    LoadableScreen(vm) { s ->
        Page {
            SectionTitle("In house")
            if (s.inHouse.isEmpty()) Empty("No guests checked in.")
            s.inHouse.forEach { b ->
                BookingCard(b, s.today, busy, onRequestPayment) {
                    OutlinedButton(onClick = { confirm = b to false }, enabled = !busy) { Text("Check out") }
                }
            }
            SectionTitle("Arriving")
            if (s.upcoming.isEmpty()) Empty("No arrivals in the next 30 days.")
            s.upcoming.forEach { b ->
                BookingCard(b, s.today, busy, onRequestPayment) {
                    if (b.checkIn <= s.today) Button(onClick = { confirm = b to true }, enabled = !busy) { Text("Check in") }
                }
            }
        }
        confirm?.let { (b, arriving) ->
            ConfirmDialog(
                title = if (arriving) "Check in ${b.guestName ?: "the guest"}?" else "Check out ${b.guestName ?: "the guest"}?",
                text = "${b.unitCode} · ${formatDate(b.checkIn)} → ${formatDate(b.checkOut)}" +
                    if (b.balanceCents > 0) "\nStill owes ${formatKes(b.balanceCents)}." else "",
                confirmLabel = if (arriving) "Check in" else "Check out",
                onDismiss = { confirm = null },
                onConfirm = { if (arriving) vm.checkIn(b) else vm.checkOut(b); confirm = null },
            )
        }
    }
}

@Composable
private fun BookingCard(b: Booking, today: String, busy: Boolean, onRequestPayment: (UUID) -> Unit, action: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${b.guestName ?: "Guest"} · ${b.unitCode}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                StatusChip(b.source.label)
            }
            Text("${b.propertyName} · ${formatDate(b.checkIn)} → ${formatDate(b.checkOut)} · ${b.nights} nights")
            if (b.isRepeatGuest) StatusChip("Returning guest", Tone.GOOD)
            if (b.checkIn == today && b.status == BookingStatus.CONFIRMED) StatusChip("Arrives today", Tone.WARN)
            if (b.checkOut == today && b.status == BookingStatus.CHECKED_IN) StatusChip("Leaves today", Tone.WARN)
            Text(if (b.balanceCents > 0) "Owes ${formatKes(b.balanceCents)} of ${formatKes(b.grossCents)}" else "Paid in full")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                action()
                if (b.balanceCents > 0) OutlinedButton(onClick = { onRequestPayment(b.id) }, enabled = !busy) { Text("Request payment") }
            }
        }
    }
}
