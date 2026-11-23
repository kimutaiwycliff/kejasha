package ke.kejasha.app.data.sync

import androidx.room.withTransaction
import ke.kejasha.api.endpoints.SyncApi
import ke.kejasha.api.models.SyncPullResponse
import ke.kejasha.api.models.SyncPushBodyInput
import ke.kejasha.api.models.SyncPushBodyInputCashCollectionsInner
import ke.kejasha.api.models.SyncPushBodyInputMeterReadingsInner
import ke.kejasha.api.models.SyncPushBodyInputTicketUpdatesInner
import ke.kejasha.api.models.SyncPushBodyInputTicketsInner
import ke.kejasha.api.models.SyncPushResult
import ke.kejasha.api.models.UploadRequestInput
import ke.kejasha.app.data.db.CashEntity
import ke.kejasha.app.data.db.KejashaDb
import ke.kejasha.app.data.db.MeterEntity
import ke.kejasha.app.data.db.OutboxEntity
import ke.kejasha.app.data.db.PropertyEntity
import ke.kejasha.app.data.db.ReadingEntity
import ke.kejasha.app.data.db.SyncStateEntity
import ke.kejasha.app.data.db.TicketEntity
import ke.kejasha.app.data.db.TicketUpdateEntity
import ke.kejasha.app.data.db.UnitEntity
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.ApiJson
import ke.kejasha.app.net.Uploader
import ke.kejasha.app.net.api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** What one sync did: records the API took, and records it refused (now dead letters). */
data class SyncOutcome(val pushed: Int, val rejected: Int)

/**
 * The ADR-017 sync protocol for the caretaker's offline copy:
 * 1. push the outbox (photos uploaded first) in batches of ≤ 200, oldest first; `applied` and
 *    `duplicate` clear an entry, `rejected` turns it into a dead letter with the API's reason;
 * 2. pull changes since the stored cursor until `hasMore` is false; `reset` replaces the snapshot.
 * One sync runs at a time. The data on this phone belongs to one organization: syncing another
 * starts from a fresh snapshot.
 */
@Singleton
class SyncEngine @Inject constructor(
    private val db: KejashaDb,
    private val sync: SyncApi,
    private val uploader: Uploader,
) {
    private val mutex = Mutex()
    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    suspend fun sync(orgId: String): SyncOutcome = mutex.withLock {
        _running.value = true
        try {
            val outcome = push(orgId)
            pull(orgId)
            db.syncState().put(SyncStateEntity(orgId, db.syncState().get(orgId)?.cursor, System.currentTimeMillis(), null))
            outcome
        } catch (e: ApiError) {
            val state = db.syncState().get(orgId)
            db.syncState().put(SyncStateEntity(orgId, state?.cursor, state?.lastSyncedAt, e.userMessage))
            throw e
        } finally {
            _running.value = false
        }
    }

    private suspend fun push(orgId: String): SyncOutcome {
        var pushed = 0
        var rejected = 0
        while (true) {
            val batch = db.outbox().pending(orgId, BATCH).map { uploadPhotos(it) }
            if (batch.isEmpty()) break
            val results = api { sync.syncPush(body(batch)) }.results
            val done = results.filter { it.status != SyncPushResult.Status.REJECTED }.map { it.id.toString() }
            results.filter { it.status == SyncPushResult.Status.REJECTED }.forEach {
                db.outbox().kill(it.id.toString(), it.code, it.message)
                rejected++
            }
            batch.filter { it.id in done }.forEach { e -> paths(e.photoPaths).forEach { File(it).delete() } }
            db.outbox().remove(done)
            pushed += done.size
            // A batch the API answered only in part: stop rather than loop on the rest.
            if (batch.size < BATCH || done.size + results.count { it.status == SyncPushResult.Status.REJECTED } < batch.size) break
        }
        return SyncOutcome(pushed, rejected)
    }

    /** Uploads the photos not yet uploaded, saving each key so a retry does not upload twice. */
    private suspend fun uploadPhotos(entry: OutboxEntity): OutboxEntity {
        val files = paths(entry.photoPaths)
        val keys = paths(entry.photoKeys).toMutableList()
        if (keys.size >= files.size) return entry
        val purpose = if (entry.type == CASH) UploadRequestInput.Purpose.CASH_RECEIPT else UploadRequestInput.Purpose.MAINTENANCE_PHOTO
        for (path in files.drop(keys.size)) {
            val bytes = withContext(Dispatchers.IO) { File(path).takeIf { it.exists() }?.readBytes() } ?: continue
            keys += uploader.upload(purpose, bytes)
            db.outbox().setPhotoKeys(entry.id, encode(keys))
        }
        return entry.copy(photoKeys = encode(keys))
    }

    private fun body(batch: List<OutboxEntity>): SyncPushBodyInput {
        fun keys(e: OutboxEntity) = paths(e.photoKeys).ifEmpty { null }
        val byType = batch.groupBy { it.type }
        return SyncPushBodyInput(
            tickets = byType[TICKET]?.map { ApiJson.decodeFromString(SyncPushBodyInputTicketsInner.serializer(), it.payload).copy(photoKeys = keys(it)) },
            ticketUpdates = byType[TICKET_UPDATE]?.map { ApiJson.decodeFromString(SyncPushBodyInputTicketUpdatesInner.serializer(), it.payload).copy(photoKeys = keys(it)) },
            meterReadings = byType[METER_READING]?.map { ApiJson.decodeFromString(SyncPushBodyInputMeterReadingsInner.serializer(), it.payload) },
            cashCollections = byType[CASH]?.map { ApiJson.decodeFromString(SyncPushBodyInputCashCollectionsInner.serializer(), it.payload).copy(receiptKey = keys(it)?.first()) },
        )
    }

    private suspend fun pull(orgId: String) {
        // First sync, or another organization's copy is on this phone: start from a full snapshot.
        if (db.syncState().get(orgId) == null || db.syncState().others(orgId) > 0) {
            db.withTransaction {
                clearSnapshot()
                db.syncState().deleteOthers(orgId)
                db.syncState().put(SyncStateEntity(orgId, cursor = null, lastSyncedAt = null, lastError = null))
            }
        }
        var cursor = db.syncState().get(orgId)?.cursor
        do {
            val page = api { sync.syncPull(cursor) }
            db.withTransaction {
                apply(page)
                val state = db.syncState().get(orgId)
                db.syncState().put(SyncStateEntity(orgId, page.cursor, state?.lastSyncedAt, state?.lastError))
            }
            cursor = page.cursor
        } while (page.hasMore)
    }

    private suspend fun clearSnapshot() = with(db.snapshot()) {
        clearProperties(); clearUnits(); clearMeters(); clearReadings(); clearTickets(); clearTicketUpdates(); clearCash()
    }

    private suspend fun apply(page: SyncPullResponse) = with(db.snapshot()) {
        if (page.reset) clearSnapshot()
        val c = page.changes
        properties(c.properties.upserted.map { PropertyEntity(it.id.toString(), it.name, it.county, it.area) })
        units(c.units.upserted.map { UnitEntity(it.id.toString(), it.propertyId.toString(), it.code, it.label, it.mode.value, it.status.value) })
        meters(c.meters.upserted.map { MeterEntity(it.id.toString(), it.unitId.toString(), it.kind.value, it.serial, it.unitLabel) })
        readings(c.meterReadings.upserted.map { ReadingEntity(it.id.toString(), it.meterId.toString(), it.readOn, it.reading, it.note) })
        tickets(
            c.tickets.upserted.map {
                TicketEntity(
                    it.id.toString(), it.number, it.propertyId.toString(), it.unitId?.toString(), it.title, it.description,
                    it.category.value, it.priority.value, it.status.value, it.costCents, it.createdAt,
                )
            },
        )
        ticketUpdates(
            c.ticketUpdates.upserted.map {
                TicketUpdateEntity(it.id.toString(), it.ticketId.toString(), it.note, it.statusFrom?.value, it.statusTo?.value, it.photoKeys.size, it.createdAt)
            },
        )
        val cashIds = c.cashCollections.upserted.map { it.id.toString() }
        val units = if (cashIds.isEmpty()) emptyMap() else cashUnits(cashIds).associate { it.id to it.unitId }
        cash(
            c.cashCollections.upserted.map {
                CashEntity(
                    it.id.toString(), units[it.id.toString()], it.leaseId?.toString(), it.amountCents, it.receivedOn,
                    it.payerName, it.note, it.status.value, it.rejectReason, it.createdAt,
                )
            },
        )
        deleteProperties(c.properties.deleted.map { it.toString() })
        deleteUnits(c.units.deleted.map { it.toString() })
        deleteMeters(c.meters.deleted.map { it.toString() })
        deleteReadings(c.meterReadings.deleted.map { it.toString() })
        deleteTickets(c.tickets.deleted.map { it.toString() })
        deleteTicketUpdates(c.ticketUpdates.deleted.map { it.toString() })
        deleteCash(c.cashCollections.deleted.map { it.toString() })
    }

    companion object {
        const val BATCH = 200
        const val TICKET = "ticket"
        const val TICKET_UPDATE = "ticket_update"
        const val METER_READING = "meter_reading"
        const val CASH = "cash_collection"

        private val strings = ListSerializer(String.serializer())
        fun encode(list: List<String>): String = ApiJson.encodeToString(strings, list)
        fun paths(json: String): List<String> = ApiJson.decodeFromString(strings, json)
    }
}
