package ke.kejasha.app.ui.owner

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.PaymentsApi
import ke.kejasha.api.models.CashCollection
import ke.kejasha.api.models.CashCollectionStatusInput
import ke.kejasha.api.models.MatchStatusInput
import ke.kejasha.api.models.Payment
import ke.kejasha.api.models.ReasonBodyInput
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.ConfirmDialog
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.ReasonDialog
import ke.kejasha.app.ui.common.clickableRow
import ke.kejasha.app.util.formatDate
import ke.kejasha.app.util.formatDateTime
import ke.kejasha.app.util.formatKes
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.util.UUID
import javax.inject.Inject

data class MoneyQueues(val toMatch: List<Payment>, val cash: List<CashCollection>)

@HiltViewModel
class MoneyViewModel @Inject constructor(private val payments: PaymentsApi) : LoadViewModel<MoneyQueues>() {
    init { refresh() }

    override suspend fun load() = coroutineScope {
        val toMatch = async { api { payments.listPayments(limit = 100, status = MatchStatusInput.UNMATCHED) }.items }
        val cash = async { api { payments.listCashCollections(limit = 100, status = CashCollectionStatusInput.PENDING) }.items }
        MoneyQueues(toMatch.await(), cash.await())
    }

    fun confirmCash(id: UUID) = act("Cash confirmed and recorded as a payment") { api { payments.confirmCashCollection(id) } }

    fun rejectCash(id: UUID, reason: String) = act("Cash rejected") { api { payments.rejectCashCollection(id, ReasonBodyInput(reason)) } }
}

@Composable
fun MoneyScreen(onPayment: (UUID) -> Unit, onRequestPayment: () -> Unit, vm: MoneyViewModel = hiltViewModel()) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        PrimaryTabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("To match") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Cash") })
        }
        LoadableScreen(vm) { q ->
            Page {
                Button(onClick = onRequestPayment, modifier = Modifier.fillMaxWidth().testTag("request-payment")) {
                    Icon(Icons.Outlined.PhoneAndroid, contentDescription = null)
                    Text("Request M-Pesa payment", Modifier.padding(start = 8.dp))
                }
                if (tab == 0) ToMatch(q.toMatch, onPayment) else Cash(q.cash, vm)
            }
        }
    }
}

@Composable
private fun ToMatch(items: List<Payment>, onPayment: (UUID) -> Unit) {
    if (items.isEmpty()) Empty("Every payment is matched to a tenant or a booking.")
    items.forEach { p ->
        ListItem(
            headlineContent = { Text("${formatKes(p.amountCents)} · ${p.payerName ?: p.msisdn ?: "Unknown payer"}") },
            supportingContent = { Text("${p.providerRef} · ${formatDateTime(p.paidAt)}" + (p.accountRef?.let { " · account $it" } ?: "")) },
            modifier = Modifier.clickableRow { onPayment(p.id) },
        )
    }
}

@Composable
private fun Cash(items: List<CashCollection>, vm: MoneyViewModel) {
    val busy by vm.busy.collectAsStateWithLifecycle()
    var confirming by remember { mutableStateOf<CashCollection?>(null) }
    var rejecting by remember { mutableStateOf<CashCollection?>(null) }
    if (items.isEmpty()) Empty("No cash waiting for you to confirm.")
    items.forEach { c ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(formatKes(c.amountCents), style = MaterialTheme.typography.titleLarge)
                Text(listOfNotNull(c.unitCode, c.payerName, "received ${formatDate(c.receivedOn)}").joinToString(" · "))
                c.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                c.receipt?.url?.takeIf { it.isNotEmpty() }?.let { url ->
                    AsyncImage(
                        model = url,
                        contentDescription = "Receipt photo",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxWidth().height(160.dp),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { confirming = c }, enabled = !busy) { Text("Confirm") }
                    OutlinedButton(onClick = { rejecting = c }, enabled = !busy) { Text("Reject") }
                }
            }
        }
    }
    confirming?.let { c ->
        ConfirmDialog(
            title = "Confirm ${formatKes(c.amountCents)}?",
            text = "It is recorded as a cash payment" + (c.unitCode?.let { " for $it" } ?: "") + ".",
            confirmLabel = "Confirm cash",
            onDismiss = { confirming = null },
            onConfirm = { vm.confirmCash(c.id); confirming = null },
        )
    }
    rejecting?.let { c ->
        ReasonDialog(
            title = "Reject ${formatKes(c.amountCents)}?",
            confirmLabel = "Reject",
            onDismiss = { rejecting = null },
            onConfirm = { vm.rejectCash(c.id, it); rejecting = null },
        )
    }
}
