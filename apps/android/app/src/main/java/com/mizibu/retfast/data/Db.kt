package com.mizibu.retfast.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

object SampleStatus {
    const val PENDING = 0
    const val SYNCED = 1
    const val REJECTED = 2
}

/** A recorded flight (local source of truth). Times are epoch milliseconds. */
@Entity(tableName = "flights")
data class FlightEntity(
    @PrimaryKey val id: String,
    val eventId: String?,
    val eventName: String?,
    val startedAt: Long,
    val endedAt: Long? = null,
    /** "recording" | "ended" */
    val state: String = "recording",
    val isSimulated: Boolean = false,
    val serverCreated: Boolean = false,
    val serverEnded: Boolean = false,
    /** Server permanently refused creating this flight (not a pilot, live tracking off, id clash). Samples stay local. */
    val createRefused: Boolean = false,
    val lastError: String? = null,
    val distanceM: Double = 0.0,
    val maxAltM: Double? = null,
    val maxSpeedMs: Double? = null,
    val ascentM: Double = 0.0,
    val descentM: Double = 0.0,
    val createdAt: Long,
    val updatedAt: Long,
)

/** One accepted GPS sample. Written to SQLite before any network use. */
@Entity(
    tableName = "samples",
    indices = [Index(value = ["flightId", "seq"], unique = true), Index("status"), Index("batchId")],
)
data class SampleEntity(
    @PrimaryKey val id: String,
    val flightId: String,
    val seq: Int,
    val t: Long,
    val deviceT: Long,
    val lat: Double,
    val lon: Double,
    val altitude: Double?,
    val hAcc: Double,
    val vAcc: Double?,
    val speed: Double?,
    val course: Double?,
    val profile: String,
    val battery: Double?,
    val lowPower: Boolean,
    val lowQuality: Boolean,
    @ColumnInfo(defaultValue = "0") val status: Int = SampleStatus.PENDING,
    val rejectReason: String? = null,
    /** Idempotent batch id: stays attached until the server acknowledged the batch. */
    val batchId: String? = null,
    @ColumnInfo(defaultValue = "0") val attempts: Int = 0,
    val lastAttemptAt: Long? = null,
)

data class StatusCount(val status: Int, val n: Int)
data class LatLonRow(val lat: Double, val lon: Double)
data class FlightCount(val flightId: String, val n: Int)

@Dao
interface FlightDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(f: FlightEntity)
    @Update suspend fun update(f: FlightEntity)
    @Query("SELECT * FROM flights WHERE id = :id") suspend fun byId(id: String): FlightEntity?
    @Query("SELECT * FROM flights WHERE id = :id") fun observe(id: String): Flow<FlightEntity?>
    @Query("SELECT * FROM flights WHERE state = 'recording' ORDER BY startedAt DESC LIMIT 1") suspend fun active(): FlightEntity?
    @Query("SELECT * FROM flights ORDER BY startedAt DESC") fun observeAll(): Flow<List<FlightEntity>>
    @Query("SELECT * FROM flights WHERE serverCreated = 0 AND createRefused = 0 ORDER BY startedAt") suspend fun needingCreate(): List<FlightEntity>
    @Query("SELECT * FROM flights WHERE state = 'ended' AND serverCreated = 1 AND serverEnded = 0 ORDER BY startedAt") suspend fun needingEnd(): List<FlightEntity>

    /** Only a flight with no unsynced samples may be removed (never delete unsynced data). */
    @Query(
        "DELETE FROM flights WHERE id = :id AND state = 'ended' AND NOT EXISTS (SELECT 1 FROM samples WHERE flightId = :id AND status = 0)",
    )
    suspend fun deleteIfFullySynced(id: String): Int
}

@Dao
interface SampleDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insert(s: SampleEntity): Long
    @Query("SELECT COALESCE(MAX(seq), -1) + 1 FROM samples WHERE flightId = :flightId") suspend fun nextSeq(flightId: String): Int
    @Query("SELECT * FROM samples WHERE flightId = :flightId ORDER BY seq") suspend fun forFlight(flightId: String): List<SampleEntity>
    @Query("SELECT * FROM samples WHERE flightId = :flightId ORDER BY seq") fun observeFlight(flightId: String): Flow<List<SampleEntity>>
    @Query("SELECT * FROM samples WHERE batchId = :batchId AND status = 0 ORDER BY seq") suspend fun inBatch(batchId: String): List<SampleEntity>
    @Query("SELECT COUNT(*) FROM samples WHERE status = 0") suspend fun pendingCount(): Int
    @Query("SELECT COUNT(*) FROM samples WHERE status = 0") fun observePendingCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM samples WHERE flightId = :flightId AND status = 0") suspend fun pendingCount(flightId: String): Int
    @Query("SELECT flightId, COUNT(*) AS n FROM samples WHERE status = 0 GROUP BY flightId") fun observePendingByFlight(): Flow<List<FlightCount>>
    @Query("SELECT COUNT(*) FROM samples WHERE flightId = :flightId AND status = 0") fun observePendingCount(flightId: String): Flow<Int>
    @Query("SELECT status, COUNT(*) AS n FROM samples WHERE flightId = :flightId GROUP BY status") fun observeCounts(flightId: String): Flow<List<StatusCount>>
    @Query("SELECT status, COUNT(*) AS n FROM samples WHERE flightId = :flightId GROUP BY status") suspend fun counts(flightId: String): List<StatusCount>
    @Query("SELECT * FROM samples WHERE flightId = :flightId ORDER BY seq DESC LIMIT 1") suspend fun last(flightId: String): SampleEntity?
    @Query("SELECT lat, lon FROM samples WHERE flightId = :flightId ORDER BY seq DESC LIMIT :n") suspend fun recentPoints(flightId: String, n: Int): List<LatLonRow>

    /** A batch id already attached to unacknowledged samples (must be re-sent with the same id). */
    @Query(
        """SELECT s.batchId FROM samples s JOIN flights f ON f.id = s.flightId
           WHERE s.status = 0 AND s.batchId IS NOT NULL AND f.createRefused = 0
           ORDER BY s.t LIMIT 1""",
    )
    suspend fun openBatchId(): String?

    @Query(
        """SELECT s.flightId FROM samples s JOIN flights f ON f.id = s.flightId
           WHERE s.status = 0 AND s.batchId IS NULL AND f.createRefused = 0
           GROUP BY s.flightId ORDER BY MIN(s.t) LIMIT 1""",
    )
    suspend fun nextFlightWithUnbatched(): String?

    @Query("SELECT * FROM samples WHERE flightId = :flightId AND status = 0 AND batchId IS NULL ORDER BY seq LIMIT :limit")
    suspend fun unbatched(flightId: String, limit: Int): List<SampleEntity>

    @Query("UPDATE samples SET batchId = :batchId WHERE id IN (:ids)") suspend fun assignBatch(batchId: String, ids: List<String>)
    @Query("UPDATE samples SET batchId = NULL WHERE batchId = :batchId AND status = 0") suspend fun releaseBatch(batchId: String)
    @Query("UPDATE samples SET status = 1, batchId = NULL, rejectReason = NULL WHERE flightId = :flightId AND batchId = :batchId AND seq IN (:seqs) AND status = 0")
    suspend fun markSynced(flightId: String, batchId: String, seqs: List<Int>)
    @Query("UPDATE samples SET status = 2, batchId = NULL, rejectReason = :reason WHERE flightId = :flightId AND batchId = :batchId AND seq = :seq AND status = 0")
    suspend fun markRejected(flightId: String, batchId: String, seq: Int, reason: String)
    @Query("UPDATE samples SET status = 2, batchId = NULL, rejectReason = :reason WHERE batchId = :batchId AND status = 0")
    suspend fun rejectBatch(batchId: String, reason: String)
    @Query("UPDATE samples SET attempts = attempts + 1, lastAttemptAt = :at WHERE batchId = :batchId AND status = 0")
    suspend fun recordAttempt(batchId: String, at: Long)
    @Query("SELECT MAX(lastAttemptAt) FROM samples") suspend fun lastAttemptAt(): Long?
}

/** Pilot retrieval request: the outbox. Mirrors the iOS `LocalRetrieval`. */
@Entity(tableName = "retrievals")
data class RetrievalEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val eventName: String?,
    val flightId: String?,
    val pickupLat: Double,
    val pickupLon: Double,
    val pickupAlt: Double?,
    val pickupHAcc: Double?,
    val pickupT: Long,
    val note: String,
    val createdAt: Long,
    /** "pending" | "sent" | "refused" | "merged" */
    val outbox: String = "pending",
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
    val lastError: String? = null,
    val serverStatus: String? = null,
    val serverJson: String? = null,
    val cancelRequested: Boolean = false,
    val cancelReason: String? = null,
    val cancelSynced: Boolean = false,
    val mergedInto: String? = null,
    val updatedAt: Long,
)

object Outbox {
    const val PENDING = "pending"
    const val SENT = "sent"
    const val REFUSED = "refused"
    const val MERGED = "merged"
}

@Dao
interface RetrievalDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun save(r: RetrievalEntity)
    @Query("SELECT * FROM retrievals WHERE id = :id") suspend fun byId(id: String): RetrievalEntity?
    @Query("SELECT * FROM retrievals WHERE id = :id") fun observe(id: String): Flow<RetrievalEntity?>
    @Query("SELECT * FROM retrievals ORDER BY createdAt DESC LIMIT :limit") suspend fun recent(limit: Int): List<RetrievalEntity>
    @Query("SELECT * FROM retrievals ORDER BY createdAt DESC LIMIT 20") fun observeRecent(): Flow<List<RetrievalEntity>>
}

@Entity(tableName = "kv")
data class KvEntity(@PrimaryKey val k: String, val v: String?)

@Dao
interface KvDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(e: KvEntity)
    @Query("SELECT v FROM kv WHERE k = :k") suspend fun get(k: String): String?
    @Query("SELECT v FROM kv WHERE k = :k") fun observe(k: String): Flow<String?>
}

/** Latest position-share per (kind, target): replaced in place, removed once delivered. */
@Entity(tableName = "share_outbox", primaryKeys = ["kind", "targetId"])
data class ShareEntity(
    /** "pilot" | "retriever" */
    val kind: String,
    val targetId: String,
    val lat: Double,
    val lon: Double,
    val hAcc: Double,
    val t: Long,
    val altitude: Double?,
    val course: Double?,
    val speed: Double?,
    val attempts: Int = 0,
    val lastError: String? = null,
)

@Dao
interface ShareDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(e: ShareEntity)
    @Query("SELECT * FROM share_outbox") suspend fun all(): List<ShareEntity>
    @Query("DELETE FROM share_outbox WHERE kind = :kind AND targetId = :targetId AND t <= :t") suspend fun deleteDelivered(kind: String, targetId: String, t: Long)
    @Query("DELETE FROM share_outbox WHERE kind = :kind AND targetId = :targetId") suspend fun clear(kind: String, targetId: String)
    @Query("UPDATE share_outbox SET attempts = attempts + 1, lastError = :err WHERE kind = :kind AND targetId = :targetId")
    suspend fun failed(kind: String, targetId: String, err: String)
}

@Database(
    entities = [FlightEntity::class, SampleEntity::class, RetrievalEntity::class, KvEntity::class, ShareEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun flights(): FlightDao
    abstract fun samples(): SampleDao
    abstract fun retrievals(): RetrievalDao
    abstract fun kv(): KvDao
    abstract fun shares(): ShareDao

    companion object {
        /** No destructive migration fallback on purpose: unsynced samples must never be dropped. */
        fun open(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "retfast.db")
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .build()
    }
}
