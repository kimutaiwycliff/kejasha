package ke.kejasha.app.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// The caretaker's offline copy of `GET /v1/sync/pull` (ADR-017). `local = true` marks a record
// created on this phone that the API has not sent back yet (it is in the outbox).

@Entity(tableName = "property")
data class PropertyEntity(@PrimaryKey val id: String, val name: String, val county: String, val area: String?)

@Entity(tableName = "unit", indices = [Index("propertyId")])
data class UnitEntity(
    @PrimaryKey val id: String,
    val propertyId: String,
    val code: String,
    val label: String?,
    /** long_term | short_stay */
    val mode: String,
    /** active | inactive */
    val status: String,
)

@Entity(tableName = "meter", indices = [Index("unitId")])
data class MeterEntity(
    @PrimaryKey val id: String,
    val unitId: String,
    /** water | electricity */
    val kind: String,
    val serial: String?,
    /** m³, kWh */
    val unitLabel: String,
)

@Entity(tableName = "meter_reading", indices = [Index("meterId")])
data class ReadingEntity(
    @PrimaryKey val id: String,
    val meterId: String,
    val readOn: String,
    /** Decimal text as the API sends it; never parsed through floating point. */
    val reading: String,
    val note: String?,
    val local: Boolean = false,
)

@Entity(tableName = "ticket", indices = [Index("propertyId")])
data class TicketEntity(
    @PrimaryKey val id: String,
    /** Empty until the API assigns one (a ticket reported offline). */
    val number: String,
    val propertyId: String,
    val unitId: String?,
    val title: String,
    val description: String?,
    val category: String,
    val priority: String,
    val status: String,
    val costCents: Long?,
    val createdAt: String,
    val local: Boolean = false,
)

@Entity(tableName = "ticket_update", indices = [Index("ticketId")])
data class TicketUpdateEntity(
    @PrimaryKey val id: String,
    val ticketId: String,
    val note: String?,
    val statusFrom: String?,
    val statusTo: String?,
    /** Photos on the server (keys) or, for a local update, on this phone (file paths). */
    val photoCount: Int,
    val createdAt: String,
    val local: Boolean = false,
)

@Entity(tableName = "cash_collection")
data class CashEntity(
    @PrimaryKey val id: String,
    /** Set for cash logged on this phone (the API only sends lease/booking ids back). */
    val unitId: String?,
    val leaseId: String?,
    val amountCents: Long,
    val receivedOn: String,
    val payerName: String?,
    val note: String?,
    /** pending | confirmed | rejected */
    val status: String,
    val rejectReason: String?,
    val createdAt: String,
    val local: Boolean = false,
)

/** A write made offline, waiting for `POST /v1/sync/push`. */
@Entity(tableName = "outbox", indices = [Index("orgId", "state")])
data class OutboxEntity(
    /** The record's own client UUIDv7. */
    @PrimaryKey val id: String,
    val orgId: String,
    /** ticket | ticket_update | meter_reading | cash_collection (the API's push order) */
    val type: String,
    /** The push item as JSON, without photo keys. */
    val payload: String,
    /** JSON list of photo files on this phone, uploaded before the push. */
    val photoPaths: String = "[]",
    /** JSON list of keys from `POST /v1/uploads`, in [photoPaths] order, once uploaded. */
    val photoKeys: String = "[]",
    val createdAt: Long,
    /** pending | dead (rejected by the API; shown to the caretaker with [error]). */
    val state: String = "pending",
    val errorCode: String? = null,
    val error: String? = null,
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val orgId: String,
    val cursor: String?,
    val lastSyncedAt: Long?,
    val lastError: String?,
)
