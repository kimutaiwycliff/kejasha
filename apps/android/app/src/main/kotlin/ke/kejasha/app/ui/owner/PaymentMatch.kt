package ke.kejasha.app.ui.owner

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.toRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.PaymentsApi
import ke.kejasha.api.models.AllocatePaymentBodyInput
import ke.kejasha.api.models.MatchStatus
import ke.kejasha.api.models.Payment
import ke.kejasha.api.models.PaymentSuggestion
import ke.kejasha.api.models.ReasonBodyInput
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.ConfirmDialog
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.ReasonDialog
import ke.kejasha.app.ui.common.Row2
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.ui.common.label
import ke.kejasha.app.ui.shell.PaymentRoute
import ke.kejasha.app.util.formatDateTime
import ke.kejasha.app.util.formatKes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import javax.inject.Inject

data class PaymentToMatch(val payment: Payment, val suggestions: List<PaymentSuggestion>)

@HiltViewModel
class PaymentMatchViewModel @Inject constructor(
    saved: SavedStateHandle,
    private val payments: PaymentsApi,
) : LoadViewModel<PaymentToMatch>() {
    private val id = UUID.fromString(saved.toRoute<PaymentRoute>().id)

    private val _done = MutableStateFlow(false)
    /** The payment was applied or ignored: leave the screen. */
    val done: StateFlow<Boolean> = _done.asStateFlow()

    init { refresh() }

    override suspend fun load(): PaymentToMatch {
        val payment = api { payments.getPayment(id) }
        val suggestions = if (payment.matchStatus == MatchStatus.UNMATCHED) api { payments.getPaymentSuggestions(id) }.items else emptyList()
        return PaymentToMatch(payment, suggestions)
    }

    fun apply(s: PaymentSuggestion) =
        act("Applied to ${s.tenantName} · ${s.unitCode}", then = { _done.value = true }) {
            api { payments.allocatePayment(id, AllocatePaymentBodyInput(leaseId = s.leaseId)) }
        }

    fun ignore(reason: String) =
        act("Payment ignored", then = { _done.value = true }) { api { payments.ignorePayment(id, ReasonBodyInput(reason)) } }
}

@Composable
fun PaymentMatchScreen(onDone: () -> Unit, vm: PaymentMatchViewModel = hiltViewModel()) {
    val done by vm.done.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    LaunchedEffect(done) { if (done) onDone() }
    var applying by remember { mutableStateOf<PaymentSuggestion?>(null) }
    var ignoring by remember { mutableStateOf(false) }
    LoadableScreen(vm) { (p, suggestions) ->
        Page {
            Text(formatKes(p.amountCents), style = MaterialTheme.typography.headlineMedium)
            Row2("From", p.payerName ?: p.msisdn ?: "Unknown")
            p.msisdn?.let { Row2("Phone", it) }
            Row2("M-Pesa code", p.providerRef)
            Row2("Paid", formatDateTime(p.paidAt))
            p.accountRef?.let { Row2("Account number", it) }
            if (p.matchStatus != MatchStatus.UNMATCHED) {
                Empty(if (p.matchStatus == MatchStatus.MATCHED) "Already matched to ${p.tenantName ?: "a tenant"} · ${p.unitCode.orEmpty()}." else "Ignored: ${p.ignoreReason.orEmpty()}")
                return@Page
            }
            SectionTitle("Suggested tenants")
            if (suggestions.isEmpty()) Empty("No likely tenant. Match it on the web app, or ignore it if it is not rent.")
            suggestions.forEach { s ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("${s.tenantName} · ${s.unitCode}", style = MaterialTheme.typography.titleMedium)
                        Text("Owes ${formatKes(s.outstandingCents)}")
                        if (s.reasons.isNotEmpty()) Text(s.reasons.joinToString(", ") { it.label }, style = MaterialTheme.typography.bodySmall)
                        Button(onClick = { applying = s }, enabled = !busy) { Text("Apply to ${s.tenantName}") }
                    }
                }
            }
            OutlinedButton(onClick = { ignoring = true }, enabled = !busy) { Text("Ignore this payment") }
        }
        applying?.let { s ->
            ConfirmDialog(
                title = "Apply ${formatKes(p.amountCents)}?",
                text = "It is credited to ${s.tenantName} (${s.unitCode}) and a receipt is sent.",
                confirmLabel = "Apply",
                onDismiss = { applying = null },
                onConfirm = { vm.apply(s); applying = null },
            )
        }
        if (ignoring) {
            ReasonDialog("Ignore this payment?", "Ignore", onDismiss = { ignoring = false }, onConfirm = { vm.ignore(it); ignoring = false })
        }
    }
}
