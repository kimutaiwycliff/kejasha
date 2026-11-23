package ke.kejasha.app.ui.caretaker

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.models.TicketCategory
import ke.kejasha.api.models.TicketCategoryInput
import ke.kejasha.api.models.TicketPriority
import ke.kejasha.api.models.TicketPriorityInput
import ke.kejasha.api.models.TicketStatus
import ke.kejasha.api.models.TicketStatusInput
import ke.kejasha.app.data.db.CaretakerDao
import ke.kejasha.app.data.db.OutboxDao
import ke.kejasha.app.data.db.PropertyEntity
import ke.kejasha.app.data.db.TicketEntity
import ke.kejasha.app.data.db.TicketUpdateEntity
import ke.kejasha.app.data.db.UnitEntity
import ke.kejasha.app.data.sync.CaretakerRepository
import ke.kejasha.app.session.SessionRepository
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LocalSnackbar
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.PhotoButtons
import ke.kejasha.app.ui.common.Picker
import ke.kejasha.app.ui.common.Row2
import ke.kejasha.app.ui.common.SectionTitle
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.ui.common.clickableRow
import ke.kejasha.app.ui.common.label
import ke.kejasha.app.ui.common.tone
import ke.kejasha.app.ui.shell.LocalTicketRoute
import ke.kejasha.app.util.formatDateTime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

private fun status(s: String) = TicketStatus.decode(s) ?: TicketStatus.OPEN

data class RepairRow(val ticket: TicketEntity, val where: String, val refused: Boolean)

@HiltViewModel
class CaretakerRepairsViewModel @Inject constructor(dao: CaretakerDao, outbox: OutboxDao) : ViewModel() {
    val rows: StateFlow<List<RepairRow>?> = combine(dao.tickets(), dao.units(), dao.properties(), outbox.deadIds()) { tickets, units, props, dead ->
        val unitCode = units.associate { it.id to it.code }
        val propName = props.associate { it.id to it.name }
        tickets
            .sortedWith(compareBy<TicketEntity> { status(it.status) !in setOf(TicketStatus.OPEN, TicketStatus.IN_PROGRESS) }.thenByDescending { it.createdAt })
            .map { t -> RepairRow(t, listOfNotNull(t.unitId?.let(unitCode::get), propName[t.propertyId]).joinToString(" · "), t.id in dead) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

@Composable
fun CaretakerRepairsScreen(onReport: () -> Unit, onTicket: (String) -> Unit, vm: CaretakerRepairsViewModel = hiltViewModel()) {
    val rows by vm.rows.collectAsStateWithLifecycle()
    Page {
        Button(onClick = onReport, modifier = Modifier.fillMaxWidth().testTag("report-problem")) { Text("Report a problem") }
        val list = rows ?: return@Page
        if (list.isEmpty()) Empty("No repairs yet.")
        list.forEach { r ->
            ListItem(
                headlineContent = { Text(listOf(r.ticket.number.ifEmpty { "New" }, r.ticket.title).joinToString(" · ")) },
                supportingContent = { Text(r.where) },
                trailingContent = {
                    when {
                        r.refused -> StatusChip("Not accepted", Tone.BAD)
                        r.ticket.local -> StatusChip("Not sent yet", Tone.WARN)
                        else -> status(r.ticket.status).let { StatusChip(it.label, it.tone) }
                    }
                },
                modifier = Modifier.clickableRow { onTicket(r.ticket.id) },
            )
        }
    }
}

/** Photos are compressed into app storage as soon as they are picked. */
abstract class PhotoFormViewModel(private val repo: CaretakerRepository) : ViewModel() {
    val photos = mutableStateListOf<File>()
    fun addPhoto(uri: Uri) = viewModelScope.launch { if (photos.size < 6) photos += repo.keepPhoto(uri) }
    fun removePhoto(i: Int) { photos.removeAt(i).delete() }
}

@HiltViewModel
class ReportTicketViewModel @Inject constructor(
    dao: CaretakerDao,
    private val repo: CaretakerRepository,
    private val session: SessionRepository,
) : PhotoFormViewModel(repo) {
    val places: StateFlow<Pair<List<PropertyEntity>, List<UnitEntity>>> =
        combine(dao.properties(), dao.units()) { p, u -> p to u }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList<PropertyEntity>() to emptyList())

    private val _saved = MutableStateFlow(false)
    val saved: StateFlow<Boolean> = _saved.asStateFlow()

    fun report(propertyId: String, unitId: String?, title: String, category: TicketCategoryInput, priority: TicketPriorityInput, description: String) = viewModelScope.launch {
        val orgId = session.activeOrgId ?: return@launch
        repo.reportTicket(orgId, propertyId, unitId, title.trim(), category, priority, description.trim().ifEmpty { null }, photos.toList())
        _saved.value = true
    }
}

@Composable
fun ReportTicketScreen(onDone: () -> Unit, vm: ReportTicketViewModel = hiltViewModel()) {
    val (props, units) = vm.places.collectAsStateWithLifecycle().value
    val saved by vm.saved.collectAsStateWithLifecycle()
    val snackbar = LocalSnackbar.current
    LaunchedEffect(saved) { if (saved) { snackbar.showSnackbar("Problem reported. It is sent when you are online."); onDone() } }
    var property by rememberSaveable { mutableStateOf<String?>(null) }
    var unit by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(TicketCategoryInput.PLUMBING) }
    var priority by rememberSaveable { mutableStateOf(TicketPriorityInput.NORMAL) }
    val propertyId = property ?: props.singleOrNull()?.id
    Page {
        if (props.size > 1) Picker("Property", props.map { it.id to it.name }, propertyId, { property = it; unit = null }, tag = "property")
        Picker(
            "Unit",
            listOf<Pair<String?, String>>(null to "Whole property") + units.filter { it.propertyId == propertyId }.map { it.id to it.code },
            unit,
            { unit = it },
            tag = "unit",
        )
        OutlinedTextField(title, { title = it.take(200) }, label = { Text("What is wrong") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("title"))
        Picker("Category", TicketCategoryInput.entries.map { it to (TicketCategory.decode(it.value)?.label ?: it.value) }, category, { category = it }, tag = "category")
        Picker("Priority", TicketPriorityInput.entries.map { it to (TicketPriority.decode(it.value)?.label ?: it.value) }, priority, { priority = it }, tag = "priority")
        OutlinedTextField(description, { description = it.take(2000) }, label = { Text("Details (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
        PhotoButtons(onPicked = vm::addPhoto)
        PhotoStrip(vm.photos, vm::removePhoto)
        Button(
            onClick = { propertyId?.let { vm.report(it, unit, title, category, priority, description) } },
            enabled = propertyId != null && title.isNotBlank(),
            modifier = Modifier.fillMaxWidth().testTag("submit-ticket"),
        ) { Text("Report") }
    }
}

/** Caretakers move a repair along and add notes; owners close it. */
private fun caretakerStep(s: TicketStatus): Pair<String, TicketStatusInput>? = when (s) {
    TicketStatus.OPEN -> "Start work" to TicketStatusInput.IN_PROGRESS
    TicketStatus.IN_PROGRESS -> "Mark resolved" to TicketStatusInput.RESOLVED
    else -> null
}

@HiltViewModel
class LocalTicketViewModel @Inject constructor(
    saved: SavedStateHandle,
    dao: CaretakerDao,
    private val repo: CaretakerRepository,
    private val session: SessionRepository,
) : PhotoFormViewModel(repo) {
    private val id = saved.toRoute<LocalTicketRoute>().id
    val ticket: StateFlow<Pair<TicketEntity, List<TicketUpdateEntity>>?> =
        combine(dao.ticket(id), dao.updates(id)) { t, u -> t?.let { it to u } }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun update(note: String, step: TicketStatusInput?, done: () -> Unit) = viewModelScope.launch {
        val orgId = session.activeOrgId ?: return@launch
        val t = ticket.value?.first ?: return@launch
        repo.updateTicket(orgId, id, t.status, note.trim().ifEmpty { null }, step, null, photos.toList())
        photos.clear()
        done()
    }
}

@Composable
fun LocalTicketScreen(vm: LocalTicketViewModel = hiltViewModel()) {
    val data by vm.ticket.collectAsStateWithLifecycle()
    val (t, updates) = data ?: return
    var note by rememberSaveable { mutableStateOf("") }
    val snackbar = LocalSnackbar.current
    var saved by remember { mutableIntStateOf(0) }
    LaunchedEffect(saved) { if (saved > 0) snackbar.showSnackbar("Update saved. It is sent when you are online.") }
    val s = status(t.status)
    Page {
        Text(t.title, style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(s.label, s.tone)
            TicketPriority.decode(t.priority)?.let { StatusChip(it.label) }
            TicketCategory.decode(t.category)?.let { StatusChip(it.label) }
        }
        if (t.number.isNotEmpty()) Row2("Ticket", t.number)
        Row2("Reported", formatDateTime(t.createdAt))
        t.description?.let { Text(it) }
        val step = caretakerStep(s)
        if (s == TicketStatus.OPEN || s == TicketStatus.IN_PROGRESS) {
            SectionTitle("Add an update")
            OutlinedTextField(note, { note = it.take(2000) }, label = { Text("Note") }, minLines = 2, modifier = Modifier.fillMaxWidth().testTag("note"))
            PhotoButtons(onPicked = vm::addPhoto)
            PhotoStrip(vm.photos, vm::removePhoto)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                step?.let { (label, to) -> Button(onClick = { vm.update(note, to) { note = ""; saved++ } }) { Text(label) } }
                OutlinedButton(
                    onClick = { vm.update(note, null) { note = ""; saved++ } },
                    enabled = note.isNotBlank() || vm.photos.isNotEmpty(),
                ) { Text("Add note") }
            }
        }
        SectionTitle("History")
        if (updates.isEmpty()) Empty("No updates yet.")
        updates.forEach { u ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(formatDateTime(u.createdAt), style = MaterialTheme.typography.labelMedium)
                        if (u.local) StatusChip("Not sent yet", Tone.WARN)
                    }
                    u.statusTo?.let { to -> Text("${u.statusFrom?.let { status(it).label } ?: "New"} → ${status(to).label}") }
                    u.note?.let { Text(it) }
                    if (u.photoCount > 0) Text("${u.photoCount} photo${if (u.photoCount == 1) "" else "s"}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
