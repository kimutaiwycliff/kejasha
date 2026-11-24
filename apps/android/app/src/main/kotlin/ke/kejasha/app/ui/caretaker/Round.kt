package ke.kejasha.app.ui.caretaker

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.app.data.db.CaretakerDao
import ke.kejasha.app.data.db.MeterEntity
import ke.kejasha.app.data.db.OutboxDao
import ke.kejasha.app.data.db.PropertyEntity
import ke.kejasha.app.data.db.ReadingEntity
import ke.kejasha.app.data.db.UnitEntity
import ke.kejasha.app.data.sync.CaretakerRepository
import ke.kejasha.app.data.sync.SyncScheduler
import ke.kejasha.app.session.SessionRepository
import ke.kejasha.app.ui.Centered
import ke.kejasha.app.ui.common.ConfirmDialog
import ke.kejasha.app.ui.common.LocalSnackbar
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.util.formatDate
import ke.kejasha.app.util.todayNairobi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.math.BigDecimal
import javax.inject.Inject

private val READING = Regex("""\d{1,11}(\.\d{1,3})?""")

data class MeterRow(val meter: MeterEntity, val unit: UnitEntity, val last: ReadingEntity?, val today: ReadingEntity?)

data class RoundUi(val properties: List<PropertyEntity>, val rows: List<Pair<String, MeterRow>>, val refused: Set<String>)

@HiltViewModel
class RoundViewModel @Inject constructor(
    dao: CaretakerDao,
    outbox: OutboxDao,
    private val repo: CaretakerRepository,
    private val session: SessionRepository,
    private val scheduler: SyncScheduler,
) : ViewModel() {
    val ui: StateFlow<RoundUi?> = combine(dao.properties(), dao.units(), dao.meters(), dao.readings(), outbox.deadIds()) { props, units, meters, readings, dead ->
        val unitById = units.associateBy { it.id }
        val day = todayNairobi().toString()
        val byMeter = readings.groupBy { it.meterId }
        val rows = meters.mapNotNull { m ->
            val unit = unitById[m.unitId] ?: return@mapNotNull null
            val history = byMeter[m.id].orEmpty()
            unit.propertyId to MeterRow(m, unit, history.firstOrNull { it.readOn < day }, history.firstOrNull { it.readOn == day })
        }.sortedWith(compareBy({ it.second.unit.code }, { it.second.meter.kind }))
        RoundUi(props, rows, dead.toSet())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    fun save(row: MeterRow, reading: String) = viewModelScope.launch {
        val orgId = session.activeOrgId ?: return@launch
        repo.recordReading(orgId, row.meter.id, todayNairobi().toString(), reading, null)
        _message.value = "Saved ${row.unit.code} ${row.meter.kind}: $reading. It is sent when you are online."
    }

    fun syncNow() = scheduler.now()
    fun messageShown() { _message.value = null }
}

/** Walk the property and read every meter; works without signal. */
@Composable
fun RoundScreen(vm: RoundViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = LocalSnackbar.current
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.messageShown() } }
    var property by rememberSaveable { mutableStateOf<String?>(null) }
    val u = ui ?: return
    if (u.properties.isEmpty()) {
        Centered {
            Text("Nothing downloaded yet", style = MaterialTheme.typography.titleLarge)
            Text("Connect to the internet once to download your properties.")
            Button(onClick = vm::syncNow) { Text("Sync now") }
        }
        return
    }
    val shown = property ?: u.properties.first().id
    Column(Modifier.fillMaxSize()) {
        if (u.properties.size > 1) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                u.properties.forEach { p -> FilterChip(selected = p.id == shown, onClick = { property = p.id }, label = { Text(p.name) }) }
            }
        }
        val rows = u.rows.filter { it.first == shown }.map { it.second }
        val done = rows.count { it.today != null }
        Text("$done of ${rows.size} meters read today", modifier = Modifier.padding(horizontal = 16.dp))
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(rows, key = { it.meter.id }) { MeterCard(it, refused = it.today?.id in u.refused, onSave = { r -> vm.save(it, r) }) }
        }
    }
}

@Composable
private fun MeterCard(row: MeterRow, refused: Boolean, onSave: (String) -> Unit) {
    var text by rememberSaveable(row.meter.id) { mutableStateOf("") }
    var confirmLow by rememberSaveable(row.meter.id) { mutableStateOf(false) }
    val kind = if (row.meter.kind == "water") "Water" else "Electricity"
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${row.unit.code} · $kind (${row.meter.unitLabel})", style = MaterialTheme.typography.titleMedium)
            row.meter.serial?.let { Text("Meter $it", style = MaterialTheme.typography.bodySmall) }
            Text(row.last?.let { "Last: ${it.reading} on ${formatDate(it.readOn)}" } ?: "No earlier reading")
            val today = row.today
            if (today != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Today: ${today.reading}")
                    when {
                        refused -> StatusChip("Not accepted — see Sync", Tone.BAD)
                        today.local -> StatusChip("Not sent yet", Tone.WARN)
                        else -> StatusChip("Sent", Tone.GOOD)
                    }
                }
                return@Column
            }
            val valid = READING.matches(text)
            OutlinedTextField(
                value = text,
                onValueChange = { text = it.filter { c -> c.isDigit() || c == '.' }.take(15) },
                label = { Text("Reading today") },
                isError = text.isNotEmpty() && !valid,
                supportingText = if (text.isNotEmpty() && !valid) ({ Text("Digits, up to 3 decimals") }) else null,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth().testTag("reading-${row.unit.code}-${row.meter.kind}"),
            )
            Button(
                onClick = {
                    val lower = row.last?.let { BigDecimal(text) < BigDecimal(it.reading) } == true
                    if (lower) confirmLow = true else onSave(text)
                },
                enabled = valid,
            ) { Text("Save reading") }
        }
    }
    if (confirmLow) {
        ConfirmDialog(
            title = "Lower than last time?",
            text = "$text is below the last reading (${row.last?.reading}). Check the meter, or save it if it was replaced.",
            confirmLabel = "Save anyway",
            onDismiss = { confirmLow = false },
            onConfirm = { confirmLow = false; onSave(text) },
        )
    }
}
