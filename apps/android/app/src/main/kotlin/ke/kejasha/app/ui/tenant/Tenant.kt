package ke.kejasha.app.ui.tenant

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.PortalApi
import ke.kejasha.api.models.LeaseStatement
import ke.kejasha.api.models.PortalLease
import ke.kejasha.api.models.PortalMe
import ke.kejasha.api.models.PortalPayBodyInput
import ke.kejasha.api.models.PortalTicketBodyInput
import ke.kejasha.api.models.Ticket
import ke.kejasha.api.models.TicketCategory
import ke.kejasha.api.models.TicketCategoryInput
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.Picker
import ke.kejasha.app.ui.common.Row2
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.ui.common.label
import ke.kejasha.app.ui.common.tone
import ke.kejasha.app.ui.shell.TenantPayRoute
import ke.kejasha.app.util.formatDate
import ke.kejasha.app.util.formatKes
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/** A lease with its landlord, for lists across every landlord that holds this phone. */
data class TenantLease(val landlord: String, val lease: PortalLease)

private fun PortalMe.leases() = tenancies.flatMap { t -> t.leases.map { TenantLease(t.landlordName, it) } }

/** M-Pesa prompts are in whole shillings: a balance with cents rounds up. */
fun promptShillings(balanceCents: Long): Long = (balanceCents + 99) / 100

// ── Home ────────────────────────────────────────────────────────────────────────────────────

@HiltViewModel
class TenantHomeViewModel @Inject constructor(private val portal: PortalApi) : LoadViewModel<PortalMe>() {
    init { refresh() }
    override suspend fun load() = api { portal.portalMe() }
}

@Composable
fun TenantHomeScreen(name: String, onPay: (UUID) -> Unit, vm: TenantHomeViewModel = hiltViewModel()) = LoadableScreen(vm) { me ->
    Page {
        Text("Hello $name", style = MaterialTheme.typography.titleLarge)
        val leases = me.leases()
        if (leases.isEmpty()) Empty("No homes are linked to your phone number yet. Ask your landlord to add it to your tenancy.")
        leases.forEach { (landlord, l) ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${l.unitCode} · ${l.propertyName}", style = MaterialTheme.typography.titleMedium)
                    Text("Landlord: $landlord", style = MaterialTheme.typography.bodySmall)
                    Row2("Rent", "${formatKes(l.currentRentCents)} a month")
                    Row2("You owe", formatKes(maxOf(l.balanceCents, 0)))
                    if (l.balanceCents < 0) Text("You have ${formatKes(-l.balanceCents)} in credit.")
                    if (l.status == PortalLease.Status.ACTIVE) {
                        Button(onClick = { onPay(l.leaseId) }, modifier = Modifier.testTag("pay-${l.unitCode}")) { Text("Pay with M-Pesa") }
                    } else {
                        StatusChip("Ended", Tone.NEUTRAL)
                    }
                }
            }
        }
    }
}

// ── Pay ─────────────────────────────────────────────────────────────────────────────────────

sealed interface PayState {
    data object Idle : PayState
    /** The prompt is on the phone; the balance is watched until it drops. */
    data class Waiting(val amountCents: Long, val phone: String) : PayState
    data class Paid(val amountCents: Long) : PayState
    /** No change seen in time: the tenant may have cancelled, or M-Pesa is slow. */
    data class Unconfirmed(val amountCents: Long) : PayState
}

@HiltViewModel
class TenantPayViewModel @Inject constructor(saved: SavedStateHandle, private val portal: PortalApi) : LoadViewModel<TenantLease>() {
    private val leaseId = UUID.fromString(saved.toRoute<TenantPayRoute>().leaseId)
    private val _pay = MutableStateFlow<PayState>(PayState.Idle)
    val pay: StateFlow<PayState> = _pay.asStateFlow()
    private var watching: Job? = null

    init { refresh() }

    override suspend fun load(): TenantLease =
        api { portal.portalMe() }.leases().firstOrNull { it.lease.leaseId == leaseId } ?: throw ApiError.Http(404, "not_found", "This lease is no longer linked to your phone.", null)

    fun send(shillings: Long) = act(null) {
        val before = (state.value as? ke.kejasha.app.ui.common.Loadable.Ready)?.data?.lease?.balanceCents ?: 0
        val request = api { portal.portalPay(leaseId, PortalPayBodyInput(amountCents = shillings * 100)) }
        _pay.value = PayState.Waiting(request.amountCents, request.msisdn)
        watch(before, request.amountCents)
    }

    private fun watch(before: Long, amount: Long) {
        watching?.cancel()
        watching = viewModelScope.launch {
            repeat(24) {
                delay(5_000)
                val now = try { load().lease.balanceCents } catch (e: ApiError) { return@repeat }
                if (now < before) {
                    _pay.value = PayState.Paid(amount)
                    refresh()
                    return@launch
                }
            }
            _pay.value = PayState.Unconfirmed(amount)
        }
    }

    fun reset() { watching?.cancel(); _pay.value = PayState.Idle }
}

@Composable
fun TenantPayScreen(onDone: () -> Unit, vm: TenantPayViewModel = hiltViewModel()) {
    val pay by vm.pay.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    LoadableScreen(vm) { (landlord, l) ->
        var amount by rememberSaveable { mutableStateOf("") }
        LaunchedEffect(l.leaseId) { if (amount.isEmpty() && l.balanceCents > 0) amount = promptShillings(l.balanceCents).toString() }
        Page {
            Text("${l.unitCode} · ${l.propertyName}", style = MaterialTheme.typography.titleLarge)
            Text("Paid to $landlord's own M-Pesa account.", style = MaterialTheme.typography.bodySmall)
            when (val p = pay) {
                PayState.Idle -> {
                    Row2("You owe", formatKes(maxOf(l.balanceCents, 0)))
                    val shillings = amount.toLongOrNull()
                    OutlinedTextField(
                        value = amount,
                        onValueChange = { amount = it.filter(Char::isDigit).take(9) },
                        label = { Text("Amount") },
                        prefix = { Text("Ksh ") },
                        supportingText = { Text("Whole shillings.") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth().testTag("amount"),
                    )
                    Button(
                        onClick = { shillings?.let(vm::send) },
                        enabled = !busy && shillings != null && shillings >= 1,
                        modifier = Modifier.fillMaxWidth().testTag("send-prompt"),
                    ) { Text("Send M-Pesa prompt") }
                }
                is PayState.Waiting -> {
                    CircularProgressIndicator()
                    Text("Check your phone (${p.phone}) and enter your M-Pesa PIN to pay ${formatKes(p.amountCents)}.")
                }
                is PayState.Paid -> {
                    StatusChip("Paid ${formatKes(p.amountCents)}", Tone.GOOD)
                    Text("Your landlord has the payment. A receipt comes by SMS.")
                    Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Done") }
                }
                is PayState.Unconfirmed -> {
                    StatusChip("Not confirmed yet", Tone.WARN)
                    Text("If you entered your PIN, the payment shows on your balance shortly. Otherwise try again.")
                    Button(onClick = vm::reset, modifier = Modifier.fillMaxWidth()) { Text("Try again") }
                }
            }
        }
    }
}

// ── Statement ───────────────────────────────────────────────────────────────────────────────

data class TenantStatement(val leases: List<TenantLease>, val selected: UUID?, val statement: LeaseStatement?)

@HiltViewModel
class TenantStatementViewModel @Inject constructor(private val portal: PortalApi) : LoadViewModel<TenantStatement>() {
    private var selected: UUID? = null

    init { refresh() }

    override suspend fun load(): TenantStatement {
        val leases = api { portal.portalMe() }.leases()
        val id = selected ?: leases.firstOrNull { it.lease.status == PortalLease.Status.ACTIVE }?.lease?.leaseId ?: leases.firstOrNull()?.lease?.leaseId
        return TenantStatement(leases, id, id?.let { api { portal.portalLeaseStatement(it) } })
    }

    fun select(id: UUID) { selected = id; refresh() }
}

@Composable
fun TenantStatementScreen(vm: TenantStatementViewModel = hiltViewModel()) = LoadableScreen(vm) { s ->
    Page {
        if (s.leases.size > 1) {
            Picker("Home", s.leases.map { it.lease.leaseId to "${it.lease.unitCode} · ${it.lease.propertyName}" }, s.selected, vm::select, tag = "lease")
        }
        val st = s.statement ?: return@Page Empty("No statement yet.")
        Row2("From", formatDate(st.from))
        Row2("Opening balance", formatKes(st.openingBalanceCents))
        Row2("Closing balance", formatKes(st.closingBalanceCents))
        SectionTitle("Entries")
        if (st.items.isEmpty()) Empty("Nothing in this period.")
        st.items.sortedByDescending { it.date }.forEach { line ->
            ListItem(
                headlineContent = { Text(line.description) },
                supportingContent = { Text(listOfNotNull(formatDate(line.date), line.reference).joinToString(" · ")) },
                trailingContent = {
                    Text(if (line.creditCents > 0) "−${formatKes(line.creditCents)}" else formatKes(line.debitCents))
                },
            )
        }
    }
}

// ── Repairs ─────────────────────────────────────────────────────────────────────────────────

data class TenantRepairs(val leases: List<TenantLease>, val tickets: List<Ticket>)

@HiltViewModel
class TenantRepairsViewModel @Inject constructor(private val portal: PortalApi) : LoadViewModel<TenantRepairs>() {
    private val _reported = MutableStateFlow(0)
    val reported: StateFlow<Int> = _reported.asStateFlow()

    init { refresh() }

    override suspend fun load() = TenantRepairs(
        api { portal.portalMe() }.leases().filter { it.lease.status == PortalLease.Status.ACTIVE },
        api { portal.portalTickets() }.items.sortedByDescending { it.createdAt },
    )

    fun report(leaseId: UUID, title: String, category: TicketCategoryInput, description: String) =
        act("Problem reported to your landlord", then = { _reported.value++ }) {
            api { portal.portalReportTicket(PortalTicketBodyInput(leaseId, title.trim(), category, description.trim().ifEmpty { null })) }
        }
}

@Composable
fun TenantRepairsScreen(vm: TenantRepairsViewModel = hiltViewModel()) {
    val busy by vm.busy.collectAsStateWithLifecycle()
    val reported by vm.reported.collectAsStateWithLifecycle()
    var lease by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable(reported) { mutableStateOf("") }
    var description by rememberSaveable(reported) { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(TicketCategoryInput.PLUMBING) }
    LoadableScreen(vm) { r ->
        Page {
            if (r.leases.isNotEmpty()) {
                SectionTitle("Report a problem")
                val leaseId = lease?.let(UUID::fromString) ?: r.leases.first().lease.leaseId
                if (r.leases.size > 1) {
                    Picker("Home", r.leases.map { it.lease.leaseId to "${it.lease.unitCode} · ${it.lease.propertyName}" }, leaseId, { lease = it.toString() }, tag = "lease")
                }
                OutlinedTextField(title, { title = it.take(200) }, label = { Text("What is wrong") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("title"))
                Picker("Category", TicketCategoryInput.entries.map { it to (TicketCategory.decode(it.value)?.label ?: it.value) }, category, { category = it }, tag = "category")
                OutlinedTextField(description, { description = it.take(2000) }, label = { Text("Details (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                Button(
                    onClick = { vm.report(leaseId, title, category, description) },
                    enabled = !busy && title.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().testTag("submit-ticket"),
                ) { Text("Send to landlord") }
            }
            SectionTitle("Your repairs")
            if (r.tickets.isEmpty()) Empty("No repairs reported.")
            r.tickets.forEach { t ->
                ListItem(
                    headlineContent = { Text("${t.number} · ${t.title}") },
                    supportingContent = { Text(listOfNotNull(t.unitCode, "reported ${formatDate(t.createdAt)}").joinToString(" · ")) },
                    trailingContent = { StatusChip(t.status.label, t.status.tone) },
                )
            }
        }
    }
}
