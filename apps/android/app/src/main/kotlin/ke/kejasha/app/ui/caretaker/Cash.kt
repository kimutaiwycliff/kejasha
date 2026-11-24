package ke.kejasha.app.ui.caretaker

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ListItem
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.app.data.db.CaretakerDao
import ke.kejasha.app.data.db.CashEntity
import ke.kejasha.app.data.db.OutboxDao
import ke.kejasha.app.data.db.UnitEntity
import ke.kejasha.app.data.sync.CaretakerRepository
import ke.kejasha.app.session.SessionRepository
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LocalNotifier
import ke.kejasha.app.ui.common.MoneyField
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.PhotoButtons
import ke.kejasha.app.ui.common.Picker
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.util.formatDate
import ke.kejasha.app.util.formatKes
import ke.kejasha.app.util.parseKes
import ke.kejasha.app.util.todayNairobi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CashUi(val cash: List<CashEntity>, val units: List<UnitEntity>, val refused: Set<String>)

@HiltViewModel
class CashViewModel @Inject constructor(dao: CaretakerDao, outbox: OutboxDao) : ViewModel() {
    val ui: StateFlow<CashUi?> = combine(dao.cash(), dao.units(), outbox.deadIds()) { c, u, d -> CashUi(c, u, d.toSet()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

/** Cash a tenant handed over: logged here, confirmed by the owner. */
@Composable
fun CashScreen(onLog: () -> Unit, vm: CashViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    Page {
        Button(onClick = onLog, modifier = Modifier.fillMaxWidth().testTag("log-cash")) { Text("Log cash received") }
        val u = ui ?: return@Page
        val code = u.units.associate { it.id to it.code }
        if (u.cash.isEmpty()) Empty("No cash logged yet.")
        u.cash.forEach { c ->
            ListItem(
                headlineContent = { Text(formatKes(c.amountCents) + (c.unitId?.let(code::get)?.let { " · $it" } ?: "")) },
                supportingContent = { Text(listOfNotNull(c.payerName, "received ${formatDate(c.receivedOn)}", c.rejectReason?.let { "Rejected: $it" }).joinToString(" · ")) },
                trailingContent = {
                    when {
                        c.id in u.refused -> StatusChip("Not accepted", Tone.BAD)
                        c.local -> StatusChip("Not sent yet", Tone.WARN)
                        c.status == "confirmed" -> StatusChip("Confirmed", Tone.GOOD)
                        c.status == "rejected" -> StatusChip("Rejected", Tone.BAD)
                        else -> StatusChip("With owner")
                    }
                },
            )
        }
    }
}

@HiltViewModel
class LogCashViewModel @Inject constructor(
    dao: CaretakerDao,
    private val repo: CaretakerRepository,
    private val session: SessionRepository,
) : PhotoFormViewModel(repo) {
    /** Cash is for rent on long-term units (short stays are paid to the host). */
    val units: StateFlow<List<UnitEntity>> = combine(dao.units(), dao.properties()) { u, _ -> u.filter { it.mode == "long_term" } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _saved = MutableStateFlow(false)
    val saved: StateFlow<Boolean> = _saved.asStateFlow()

    fun log(unitId: String, cents: Long, receivedOn: String, payer: String, note: String) = viewModelScope.launch {
        val orgId = session.activeOrgId ?: return@launch
        repo.logCash(orgId, unitId, cents, receivedOn, payer.trim().ifEmpty { null }, note.trim().ifEmpty { null }, photos.firstOrNull())
        _saved.value = true
    }
}

@Composable
fun LogCashScreen(onDone: () -> Unit, vm: LogCashViewModel = hiltViewModel()) {
    val units by vm.units.collectAsStateWithLifecycle()
    val saved by vm.saved.collectAsStateWithLifecycle()
    val notifier = LocalNotifier.current
    LaunchedEffect(saved) { if (saved) { notifier?.show("Cash logged. The owner confirms it."); onDone() } }
    var unit by rememberSaveable { mutableStateOf<String?>(null) }
    var amount by rememberSaveable { mutableStateOf("") }
    var payer by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    val today = todayNairobi()
    var yesterday by rememberSaveable { mutableStateOf(false) }
    val cents = parseKes(amount)
    Page {
        Picker("Unit", units.map { it.id to it.code }, unit, { unit = it }, tag = "unit")
        MoneyField("Amount", amount, { amount = it }, tag = "amount", error = if (amount.isNotEmpty() && cents == null) "Enter an amount in shillings" else null)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !yesterday, onClick = { yesterday = false }, label = { Text("Received today") })
            FilterChip(selected = yesterday, onClick = { yesterday = true }, label = { Text("Yesterday") })
        }
        OutlinedTextField(payer, { payer = it.take(120) }, label = { Text("Paid by (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("payer"))
        OutlinedTextField(note, { note = it.take(500) }, label = { Text("Note (optional)") }, modifier = Modifier.fillMaxWidth())
        Text("Receipt photo (optional)")
        if (vm.photos.isEmpty()) PhotoButtons(onPicked = vm::addPhoto)
        PhotoStrip(vm.photos, vm::removePhoto)
        Button(
            onClick = { if (unit != null && cents != null) vm.log(unit!!, cents, (if (yesterday) today.minusDays(1) else today).toString(), payer, note) },
            enabled = unit != null && cents != null,
            modifier = Modifier.fillMaxWidth().testTag("submit-cash"),
        ) { Text("Log cash") }
    }
}
