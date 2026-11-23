package ke.kejasha.app.data.sync

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import dagger.hilt.android.qualifiers.ApplicationContext
import ke.kejasha.api.models.SyncPushBodyInputCashCollectionsInner
import ke.kejasha.api.models.SyncPushBodyInputMeterReadingsInner
import ke.kejasha.api.models.SyncPushBodyInputTicketUpdatesInner
import ke.kejasha.api.models.SyncPushBodyInputTicketsInner
import ke.kejasha.api.models.TicketCategoryInput
import ke.kejasha.api.models.TicketPriorityInput
import ke.kejasha.api.models.TicketStatusInput
import ke.kejasha.app.data.db.CashEntity
import ke.kejasha.app.data.db.KejashaDb
import ke.kejasha.app.data.db.OutboxEntity
import ke.kejasha.app.data.db.ReadingEntity
import ke.kejasha.app.data.db.TicketEntity
import ke.kejasha.app.data.db.TicketUpdateEntity
import ke.kejasha.app.net.ApiJson
import ke.kejasha.app.ui.common.compressPhoto
import ke.kejasha.app.util.uuidV7
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import java.io.File
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The caretaker's writes, made offline: each one is saved on the phone (so it shows at once) and
 * queued in the outbox with a client UUIDv7, then a sync is requested.
 */
@Singleton
class CaretakerRepository @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val db: KejashaDb,
    private val scheduler: SyncScheduler,
) {
    suspend fun recordReading(orgId: String, meterId: String, readOn: String, reading: String, note: String?) {
        val id = uuidV7()
        val item = SyncPushBodyInputMeterReadingsInner(id, java.util.UUID.fromString(meterId), readOn, reading, note)
        save(orgId, SyncEngine.METER_READING, id.toString(), SyncPushBodyInputMeterReadingsInner.serializer(), item, emptyList()) {
            db.caretaker().insertReading(ReadingEntity(id.toString(), meterId, readOn, reading, note, local = true))
        }
    }

    suspend fun reportTicket(
        orgId: String,
        propertyId: String,
        unitId: String?,
        title: String,
        category: TicketCategoryInput,
        priority: TicketPriorityInput,
        description: String?,
        photos: List<File>,
    ) {
        val id = uuidV7()
        val item = SyncPushBodyInputTicketsInner(
            title = title,
            category = category,
            id = id,
            propertyId = if (unitId == null) java.util.UUID.fromString(propertyId) else null,
            unitId = unitId?.let(java.util.UUID::fromString),
            description = description,
            priority = priority,
            reporterKind = SyncPushBodyInputTicketsInner.ReporterKind.CARETAKER,
        )
        save(orgId, SyncEngine.TICKET, id.toString(), SyncPushBodyInputTicketsInner.serializer(), item, photos) {
            db.caretaker().insertTicket(
                TicketEntity(id.toString(), "", propertyId, unitId, title, description, category.value, priority.value, "open", null, now(), local = true),
            )
            if (photos.isNotEmpty()) {
                db.caretaker().insertTicketUpdate(TicketUpdateEntity(uuidV7().toString(), id.toString(), null, null, "open", photos.size, now(), local = true))
            }
        }
    }

    suspend fun updateTicket(orgId: String, ticketId: String, fromStatus: String, note: String?, status: TicketStatusInput?, costCents: Long?, photos: List<File>) {
        val id = uuidV7()
        val item = SyncPushBodyInputTicketUpdatesInner(id, java.util.UUID.fromString(ticketId), note, status, costCents)
        save(orgId, SyncEngine.TICKET_UPDATE, id.toString(), SyncPushBodyInputTicketUpdatesInner.serializer(), item, photos) {
            db.caretaker().insertTicketUpdate(TicketUpdateEntity(id.toString(), ticketId, note, status?.let { fromStatus }, status?.value, photos.size, now(), local = true))
            status?.let { db.caretaker().setTicketStatus(ticketId, it.value) }
        }
    }

    suspend fun logCash(orgId: String, unitId: String, amountCents: Long, receivedOn: String, payerName: String?, note: String?, receipt: File?) {
        val id = uuidV7()
        val item = SyncPushBodyInputCashCollectionsInner(
            amountCents = amountCents,
            receivedOn = receivedOn,
            id = id,
            unitId = java.util.UUID.fromString(unitId),
            payerName = payerName,
            note = note,
        )
        save(orgId, SyncEngine.CASH, id.toString(), SyncPushBodyInputCashCollectionsInner.serializer(), item, listOfNotNull(receipt)) {
            db.caretaker().insertCash(CashEntity(id.toString(), unitId, null, amountCents, receivedOn, payerName, note, "pending", null, now(), local = true))
        }
    }

    /** Drops a refused record from the phone (the caretaker read the reason). */
    suspend fun discard(id: String) {
        db.withTransaction {
            db.outbox().get(id)?.let { e -> SyncEngine.paths(e.photoPaths).forEach { File(it).delete() } }
            db.outbox().remove(listOf(id))
            with(db.snapshot()) { pruneReadings(); pruneTickets(); pruneTicketUpdates(); pruneCash() }
        }
    }

    /** A photo compressed into app storage at once, so it survives until it is uploaded. */
    suspend fun keepPhoto(uri: Uri): File {
        val bytes = compressPhoto(context, uri)
        return withContext(Dispatchers.IO) {
            File(File(context.filesDir, "outbox").apply { mkdirs() }, "${uuidV7()}.jpg").apply { writeBytes(bytes) }
        }
    }

    private suspend fun <T> save(
        orgId: String,
        type: String,
        id: String,
        serializer: KSerializer<T>,
        item: T,
        photos: List<File>,
        local: suspend () -> Unit,
    ) {
        db.withTransaction {
            local()
            db.outbox().add(
                OutboxEntity(
                    id = id,
                    orgId = orgId,
                    type = type,
                    payload = ApiJson.encodeToString(serializer, item),
                    photoPaths = SyncEngine.encode(photos.map { it.absolutePath }),
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
        scheduler.now()
    }

    private fun now() = Instant.now().toString()
}
