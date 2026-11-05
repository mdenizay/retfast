package com.mizibu.retfast.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.mizibu.retfast.graph
import java.util.concurrent.TimeUnit

/**
 * Constrained retry (network connected) for unsent samples and retrieval requests while the in-service loop is not
 * running: runs batches until nothing is left, retries with exponential backoff (WorkManager) otherwise.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val g = applicationContext.graph
        var rounds = 0
        while (rounds++ < 200) {
            when (val o = g.sync.syncOnce()) {
                SyncOutcome.Progressed -> continue
                SyncOutcome.Idle -> break
                SyncOutcome.AuthRequired -> return Result.success() // user must sign in; app start re-schedules
                SyncOutcome.Offline, is SyncOutcome.Failed -> return Result.retry()
            }
        }
        g.retrievals.resumeAll()
        g.sync.refreshCounters()
        return if (g.db.samples().pendingCount() > 0) Result.retry() else Result.success()
    }

    companion object {
        private const val NAME = "retfast-sync"
        fun schedule(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, req)
        }
    }
}
