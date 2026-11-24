package ke.kejasha.app.data.sync

import android.content.Context
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import ke.kejasha.app.data.db.KejashaDb
import ke.kejasha.app.session.Account
import ke.kejasha.app.session.LocalData
import ke.kejasha.app.session.Shell
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OfflineData @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val db: KejashaDb,
    private val scheduler: SyncScheduler,
) : LocalData {
    override suspend fun unsynced(): Int = db.outbox().count()

    override suspend fun clear() {
        scheduler.stop()
        withContext(Dispatchers.IO) {
            db.clearAllTables()
            File(context.filesDir, "outbox").deleteRecursively()
        }
    }

    /** Caretakers work offline: keep their copy in sync. Other roles read the API directly. */
    override fun onAccount(account: Account) {
        if (account is Account.Staff && account.shell == Shell.CARETAKER) scheduler.start() else scheduler.stop()
    }
}

@Module
@InstallIn(SingletonComponent::class)
interface LocalDataModule {
    @Binds fun localData(impl: OfflineData): LocalData
}
