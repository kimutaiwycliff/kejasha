package ke.kejasha.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** Server snapshot tables: upsert pulled rows, delete pulled ids, reset to a fresh snapshot. */
@Dao
interface SnapshotDao {
    @Upsert suspend fun properties(rows: List<PropertyEntity>)
    @Upsert suspend fun units(rows: List<UnitEntity>)
    @Upsert suspend fun meters(rows: List<MeterEntity>)
    @Upsert suspend fun readings(rows: List<ReadingEntity>)
    @Upsert suspend fun tickets(rows: List<TicketEntity>)
    @Upsert suspend fun ticketUpdates(rows: List<TicketUpdateEntity>)
    @Upsert suspend fun cash(rows: List<CashEntity>)

    @Query("DELETE FROM property WHERE id IN (:ids)") suspend fun deleteProperties(ids: List<String>)
    @Query("DELETE FROM unit WHERE id IN (:ids)") suspend fun deleteUnits(ids: List<String>)
    @Query("DELETE FROM meter WHERE id IN (:ids)") suspend fun deleteMeters(ids: List<String>)
    @Query("DELETE FROM meter_reading WHERE id IN (:ids)") suspend fun deleteReadings(ids: List<String>)
    @Query("DELETE FROM ticket WHERE id IN (:ids)") suspend fun deleteTickets(ids: List<String>)
    @Query("DELETE FROM ticket_update WHERE id IN (:ids)") suspend fun deleteTicketUpdates(ids: List<String>)
    @Query("DELETE FROM cash_collection WHERE id IN (:ids)") suspend fun deleteCash(ids: List<String>)

    @Query("SELECT id, unitId FROM cash_collection WHERE id IN (:ids) AND unitId IS NOT NULL")
    suspend fun cashUnits(ids: List<String>): List<CashUnit>

    // A reset keeps local records still in the outbox; everything else comes from the snapshot.
    @Query("DELETE FROM property") suspend fun clearProperties()
    @Query("DELETE FROM unit") suspend fun clearUnits()
    @Query("DELETE FROM meter") suspend fun clearMeters()
    @Query("DELETE FROM meter_reading WHERE local = 0") suspend fun clearReadings()
    @Query("DELETE FROM ticket WHERE local = 0") suspend fun clearTickets()
    @Query("DELETE FROM ticket_update WHERE local = 0") suspend fun clearTicketUpdates()
    @Query("DELETE FROM cash_collection WHERE local = 0") suspend fun clearCash()

    // Local records whose outbox entry was dropped (discarded dead letters).
    @Query("DELETE FROM meter_reading WHERE local = 1 AND id NOT IN (SELECT id FROM outbox)") suspend fun pruneReadings()
    @Query("DELETE FROM ticket WHERE local = 1 AND id NOT IN (SELECT id FROM outbox)") suspend fun pruneTickets()
    @Query("DELETE FROM ticket_update WHERE local = 1 AND id NOT IN (SELECT id FROM outbox)") suspend fun pruneTicketUpdates()
    @Query("DELETE FROM cash_collection WHERE local = 1 AND id NOT IN (SELECT id FROM outbox)") suspend fun pruneCash()
}

/** What the caretaker screens read (all observed, so they update after a sync). */
@Dao
interface CaretakerDao {
    @Query("SELECT * FROM property ORDER BY name") fun properties(): Flow<List<PropertyEntity>>
    @Query("SELECT * FROM unit WHERE status = 'active' ORDER BY code") fun units(): Flow<List<UnitEntity>>
    @Query("SELECT * FROM meter") fun meters(): Flow<List<MeterEntity>>

    /** The two latest readings per meter are enough to show "last" and to warn on a drop. */
    @Query("SELECT * FROM meter_reading ORDER BY readOn DESC, id DESC") fun readings(): Flow<List<ReadingEntity>>

    @Query("SELECT * FROM ticket ORDER BY createdAt DESC") fun tickets(): Flow<List<TicketEntity>>
    @Query("SELECT * FROM ticket WHERE id = :id") fun ticket(id: String): Flow<TicketEntity?>
    @Query("SELECT * FROM ticket_update WHERE ticketId = :ticketId ORDER BY createdAt DESC") fun updates(ticketId: String): Flow<List<TicketUpdateEntity>>
    @Query("SELECT * FROM cash_collection ORDER BY createdAt DESC") fun cash(): Flow<List<CashEntity>>

    @Insert suspend fun insertReading(row: ReadingEntity)
    @Insert suspend fun insertTicket(row: TicketEntity)
    @Insert suspend fun insertTicketUpdate(row: TicketUpdateEntity)
    @Insert suspend fun insertCash(row: CashEntity)
    @Query("UPDATE ticket SET status = :status WHERE id = :id") suspend fun setTicketStatus(id: String, status: String)
}

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun add(row: OutboxEntity)

    @Query("SELECT * FROM outbox WHERE orgId = :orgId AND state = 'pending' ORDER BY createdAt LIMIT :limit")
    suspend fun pending(orgId: String, limit: Int): List<OutboxEntity>

    @Query("SELECT COUNT(*) FROM outbox WHERE orgId = :orgId AND state = 'pending'") fun pendingCount(orgId: String): Flow<Int>
    @Query("SELECT * FROM outbox WHERE orgId = :orgId AND state = 'dead' ORDER BY createdAt") fun dead(orgId: String): Flow<List<OutboxEntity>>
    @Query("SELECT id FROM outbox WHERE state = 'dead'") fun deadIds(): Flow<List<String>>
    @Query("SELECT COUNT(*) FROM outbox") suspend fun count(): Int

    @Query("UPDATE outbox SET photoKeys = :keys WHERE id = :id") suspend fun setPhotoKeys(id: String, keys: String)
    @Query("UPDATE outbox SET state = 'dead', errorCode = :code, error = :message WHERE id = :id")
    suspend fun kill(id: String, code: String?, message: String?)
    @Query("DELETE FROM outbox WHERE id IN (:ids)") suspend fun remove(ids: List<String>)
    @Query("SELECT * FROM outbox WHERE id = :id") suspend fun get(id: String): OutboxEntity?
}

@Dao
interface SyncStateDao {
    @Query("SELECT * FROM sync_state WHERE orgId = :orgId") suspend fun get(orgId: String): SyncStateEntity?
    @Query("SELECT * FROM sync_state WHERE orgId = :orgId") fun observe(orgId: String): Flow<SyncStateEntity?>
    @Upsert suspend fun put(row: SyncStateEntity)
    @Query("SELECT COUNT(*) FROM sync_state WHERE orgId != :orgId") suspend fun others(orgId: String): Int
    @Query("DELETE FROM sync_state WHERE orgId != :orgId") suspend fun deleteOthers(orgId: String)
}

/** The unit a caretaker logged cash against (the API sends back only the lease). */
data class CashUnit(val id: String, val unitId: String)
