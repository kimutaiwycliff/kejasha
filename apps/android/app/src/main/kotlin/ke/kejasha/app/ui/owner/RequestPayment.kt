package ke.kejasha.app.ui.owner

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.LeasingApi
import ke.kejasha.api.endpoints.PaymentsApi
import ke.kejasha.api.endpoints.ShortStayApi
import ke.kejasha.api.models.LeaseStatusInput
import ke.kejasha.api.models.StkRequest
import ke.kejasha.api.models.StkRequestBodyInput
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.MoneyField
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.ui.common.clickableRow
import ke.kejasha.app.ui.shell.RequestPaymentRoute
import ke.kejasha.app.util.centsToInput
import ke.kejasha.app.util.formatKes
import ke.kejasha.app.util.parseKes
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/** Who is asked to pay: a lease (rent) or a booking (a stay). */
data class PayTarget(val leaseId: UUID?, val bookingId: UUID?, val title: String, val subtitle: String, val balanceCents: Long)

@HiltViewModel
class RequestPaymentViewModel @Inject constructor(
    saved: SavedStateHandle,
    private val payments: PaymentsApi,
    private val leasing: LeasingApi,
    private val stays: ShortStayApi,
) : LoadViewModel<List<PayTarget>>() {
    private val route = saved.toRoute<RequestPaymentRoute>()

    private val _request = MutableStateFlow<StkRequest?>(null)
    /** The prompt sent to the payer's phone; polled until it settles. */
    val request: StateFlow<StkRequest?> = _request.asStateFlow()
    private var polling: Job? = null

    init { refresh() }

    /** A booking (from Stays) is the only target; otherwise active leases, those owing first. */
    override suspend fun load(): List<PayTarget> {
        route.bookingId?.let { id ->
            val b = api { stays.getBooking(UUID.fromString(id)) }
            return listOf(PayTarget(null, b.id, "${b.guestName ?: "Guest"} · ${b.unitCode}", b.propertyName, b.balanceCents))
        }
        return api { leasing.listLeases(limit = 100, status = LeaseStatusInput.ACTIVE) }.items
            .map { PayTarget(it.id, null, "${it.tenantName} · ${it.unitCode}", it.propertyName, it.balanceCents) }
            .sortedWith(compareByDescending<PayTarget> { it.balanceCents }.thenBy { it.title })
            .let { all -> route.leaseId?.let { id -> all.filter { it.leaseId.toString() == id } } ?: all }
    }

    fun send(target: PayTarget, amountCents: Long, phone: String) = act(null) {
        val body = StkRequestBodyInput(
            leaseId = target.leaseId,
            bookingId = target.bookingId,
            amountCents = amountCents,
            phone = phone.trim().ifEmpty { null },
        )
        val sent = api { payments.requestStkPayment(body) }
        _request.value = sent
        poll(sent.id)
    }

    private fun poll(id: UUID) {
        polling?.cancel()
        polling = viewModelScope.launch {
            // M-Pesa prompts time out after about a minute; stop asking after two.
            repeat(40) {
                delay(3_000)
                val current = try { api { payments.getStkRequest(id) } } catch (e: ApiError) { return@repeat }
                _request.value = current
                if (current.status != StkRequest.Status.PENDING) return@launch
            }
        }
    }

    fun again() { polling?.cancel(); _request.value = null }
}

@Composable
fun RequestPaymentScreen(onDone: () -> Unit, vm: RequestPaymentViewModel = hiltViewModel()) {
    val request by vm.request.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var amount by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("") }
    LoadableScreen(vm) { targets ->
        Page {
            request?.let { r ->
                StkStatus(r)
                if (r.status != StkRequest.Status.PENDING) {
                    Button(onClick = { if (r.status == StkRequest.Status.SUCCEEDED) onDone() else vm.again() }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (r.status == StkRequest.Status.SUCCEEDED) "Done" else "Try again")
                    }
                }
                return@Page
            }
            val target = targets.firstOrNull { key(it) == selected } ?: targets.singleOrNull()
            if (target == null) {
                if (targets.size > 8) {
                    OutlinedTextField(filter, { filter = it }, label = { Text("Search tenant or unit") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("search"))
                }
                SectionTitle("Who should pay?")
                val shown = targets.filter { filter.isBlank() || it.title.contains(filter.trim(), ignoreCase = true) }
                if (shown.isEmpty()) Empty("No active leases" + if (filter.isBlank()) "." else " match.")
                shown.forEach { t ->
                    ListItem(
                        headlineContent = { Text(t.title) },
                        supportingContent = { Text("${t.subtitle} · owes ${formatKes(t.balanceCents)}") },
                        leadingContent = { RadioButton(selected = false, onClick = null) },
                        modifier = Modifier.clickableRow {
                            selected = key(t)
                            amount = if (t.balanceCents > 0) centsToInput(t.balanceCents) else ""
                        },
                    )
                }
                return@Page
            }
            // A single target (from a booking or a lease) opens with its balance filled in.
            LaunchedEffect(key(target)) { if (amount.isEmpty() && target.balanceCents > 0) amount = centsToInput(target.balanceCents) }
            Text(target.title, style = MaterialTheme.typography.titleLarge)
            Text("${target.subtitle} · owes ${formatKes(target.balanceCents)}")
            val cents = parseKes(amount)
            MoneyField("Amount", amount, { amount = it }, tag = "amount", error = if (amount.isNotEmpty() && cents == null) "Enter an amount in shillings" else null)
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it.take(20) },
                label = { Text("Phone (optional)") },
                supportingText = { Text("Leave empty to use the number on record.") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth().testTag("phone"),
            )
            Button(
                onClick = { cents?.let { vm.send(target, it, phone) } },
                enabled = !busy && cents != null,
                modifier = Modifier.fillMaxWidth().testTag("send-prompt"),
            ) { Text("Send M-Pesa prompt") }
            Text("The payer gets a prompt on their phone to enter their M-Pesa PIN. The money goes to your own Paybill or Till.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun key(t: PayTarget) = (t.leaseId ?: t.bookingId).toString()

@Composable
private fun StkStatus(r: StkRequest) {
    Text(formatKes(r.amountCents), style = MaterialTheme.typography.headlineMedium)
    Text("Prompt sent to ${r.msisdn} · account ${r.accountRef}")
    when (r.status) {
        StkRequest.Status.PENDING -> {
            CircularProgressIndicator()
            Text("Waiting for the payer to enter their PIN…")
        }
        StkRequest.Status.SUCCEEDED -> StatusChip("Paid", Tone.GOOD)
        StkRequest.Status.FAILED -> StatusChip("Failed", Tone.BAD)
        StkRequest.Status.CANCELLED -> StatusChip("Cancelled by the payer", Tone.WARN)
        StkRequest.Status.TIMEOUT -> StatusChip("No answer", Tone.WARN)
    }
    r.resultDesc?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
}
