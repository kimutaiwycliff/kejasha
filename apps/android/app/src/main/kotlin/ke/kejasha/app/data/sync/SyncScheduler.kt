package ke.kejasha.app.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.ApiJson
import ke.kejasha.app.session.Account
import ke.kejasha.app.session.TokenStore
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Runs sync when there is a network: soon after a local write, and every 15 minutes. */
@Singleton
class SyncScheduler @Inject constructor(@param:ApplicationContext private val context: Context) {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    private val work get() = WorkManager.getInstance(context)

    fun start() {
        work.enqueueUniquePeriodicWork(
            PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build(),
        )
        now()
    }

    /** A sync as soon as the phone is online (queued writes wait for signal). */
    fun now() {
        work.enqueueUniqueWork(
            ONCE,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(online)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
    }

    fun stop() {
        work.cancelUniqueWork(PERIODIC)
        work.cancelUniqueWork(ONCE)
    }

    private companion object {
        const val PERIODIC = "sync-periodic"
        const val ONCE = "sync-now"
    }
}

@EntryPoint
@InstallIn(SingletonComponent::class)
interface SyncEntryPoint {
    fun engine(): SyncEngine
    fun tokens(): TokenStore
}

/** Syncs the signed-in member's organization; nothing to do when signed out. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val deps = EntryPointAccessors.fromApplication(applicationContext, SyncEntryPoint::class.java)
        val stored = deps.tokens().load() ?: return Result.success()
        val account = stored.profile?.let { runCatching { ApiJson.decodeFromString(Account.serializer(), it) }.getOrNull() }
        val staff = account as? Account.Staff ?: return Result.success()
        return try {
            deps.engine().sync(staff.active.orgId.toString())
            Result.success()
        } catch (e: ApiError) {
            when {
                e is ApiError.Network -> Result.retry()
                e is ApiError.Http && e.status >= 500 -> Result.retry()
                // Signed out elsewhere, unpaid, or refused: the sync screen shows why.
                else -> Result.success()
            }
        }
    }
}
