package com.mizibu.retfast.tracking

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/**
 * Durable local queue for location points (docs/ios-tracking.md — the Android
 * app follows the same contract).
 *
 * Every captured fix is written here *before* any upload attempt, and carries a
 * client-generated UUID so `ingest_location_points` can upsert idempotently
 * across retries, reconnects and process death.
 */
class PointBuffer private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "points.db", null, 1) {

    data class Pending(val id: String, val payload: String)

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE pending_points(
              id TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              in_flight INTEGER NOT NULL DEFAULT 0
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = Unit

    override fun onOpen(db: SQLiteDatabase) {
        super.onOpen(db)
        db.execSQL("PRAGMA journal_mode=WAL")
        // Recover after process death: anything left in-flight is pending again.
        db.execSQL("UPDATE pending_points SET in_flight = 0")
    }

    @Synchronized
    fun enqueue(id: String, payload: JSONObject) {
        writableDatabase.execSQL(
            "INSERT OR IGNORE INTO pending_points(id, payload, created_at) VALUES(?,?,?)",
            arrayOf(id, payload.toString(), System.currentTimeMillis() / 1000),
        )
        inserts += 1
        if (inserts >= 500) {
            inserts = 0
            // Hard ceiling so a long offline stretch cannot grow the queue
            // until Android kills the process for memory.
            writableDatabase.execSQL(
                """
                DELETE FROM pending_points WHERE id IN (
                  SELECT id FROM pending_points ORDER BY created_at DESC
                  LIMIT -1 OFFSET $MAX_QUEUED
                )
                """.trimIndent(),
            )
        }
    }

    @Synchronized
    fun checkoutBatch(limit: Int): List<Pending> {
        val out = mutableListOf<Pending>()
        readableDatabase.rawQuery(
            "SELECT id, payload FROM pending_points WHERE in_flight = 0 ORDER BY created_at LIMIT ?",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) out.add(Pending(c.getString(0), c.getString(1)))
        }
        if (out.isNotEmpty()) {
            val list = out.joinToString(",") { "'${it.id}'" }
            writableDatabase.execSQL("UPDATE pending_points SET in_flight = 1 WHERE id IN ($list)")
        }
        return out
    }

    @Synchronized
    fun confirm(ids: List<String>) {
        if (ids.isEmpty()) return
        val list = ids.joinToString(",") { "'$it'" }
        writableDatabase.execSQL("DELETE FROM pending_points WHERE id IN ($list)")
    }

    @Synchronized
    fun rollback(ids: List<String>) {
        if (ids.isEmpty()) return
        val list = ids.joinToString(",") { "'$it'" }
        writableDatabase.execSQL("UPDATE pending_points SET in_flight = 0 WHERE id IN ($list)")
    }

    @Synchronized
    fun pendingCount(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM pending_points", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    private var inserts = 0

    companion object {
        private const val MAX_QUEUED = 50_000

        @Volatile
        private var instance: PointBuffer? = null

        fun get(context: Context): PointBuffer =
            instance ?: synchronized(this) {
                instance ?: PointBuffer(context).also { instance = it }
            }
    }
}
