package ke.kejasha.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Database(
    entities = [
        PropertyEntity::class, UnitEntity::class, MeterEntity::class, ReadingEntity::class,
        TicketEntity::class, TicketUpdateEntity::class, CashEntity::class,
        OutboxEntity::class, SyncStateEntity::class,
    ],
    version = 1,
)
abstract class KejashaDb : RoomDatabase() {
    abstract fun snapshot(): SnapshotDao
    abstract fun caretaker(): CaretakerDao
    abstract fun outbox(): OutboxDao
    abstract fun syncState(): SyncStateDao
}

@Module
@InstallIn(SingletonComponent::class)
object DbModule {
    @Provides @Singleton
    fun db(@ApplicationContext context: Context): KejashaDb =
        Room.databaseBuilder(context, KejashaDb::class.java, "kejasha.db").build()

    @Provides fun snapshot(db: KejashaDb) = db.snapshot()
    @Provides fun caretaker(db: KejashaDb) = db.caretaker()
    @Provides fun outbox(db: KejashaDb) = db.outbox()
    @Provides fun syncState(db: KejashaDb) = db.syncState()
}
