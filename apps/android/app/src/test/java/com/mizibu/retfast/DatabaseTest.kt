package com.mizibu.retfast

import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.data.SampleStatus
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DatabaseTest {
    private lateinit var db: AppDatabase

    @Before fun setUp() { db = memoryDb() }
    @After fun tearDown() { db.close() }

    @Test fun samplesPersistWithMonotonicSeqAndSurviveReopenOfDao() = runBlocking {
        db.seedFlight("f1", 5, state = "recording")
        assertEquals(5, db.samples().nextSeq("f1"))
        assertEquals(listOf(0, 1, 2, 3, 4), db.samples().forFlight("f1").map { it.seq })
        assertEquals(SampleStatus.PENDING, db.samples().last("f1")!!.status)
        assertNotNull(db.flights().active())
    }

    @Test fun duplicateSeqIsIgnoredNotOverwritten() = runBlocking {
        db.seedFlight("f1", 2)
        val dup = sample("f1", 1, 1L).copy(id = "other-id", lat = 1.0)
        assertEquals(-1L, db.samples().insert(dup))
        assertEquals(37.00001, db.samples().forFlight("f1")[1].lat, 1e-9)
    }

    @Test fun flightWithPendingSamplesCanNeverBeDeleted() = runBlocking {
        db.seedFlight("f1", 3)
        assertEquals(0, db.flights().deleteIfFullySynced("f1"))
        assertNotNull(db.flights().byId("f1"))
        assertEquals(3, db.samples().pendingCount())
    }

    @Test fun fullySyncedEndedFlightCanBeDeletedButRecordingOneCannot() = runBlocking {
        db.seedFlight("f1", 2)
        db.samples().assignBatch("b1", listOf("s-f1-0", "s-f1-1"))
        db.samples().markSynced("f1", "b1", listOf(0, 1))
        assertEquals(1, db.flights().deleteIfFullySynced("f1"))
        assertNull(db.flights().byId("f1"))
        db.seedFlight("f2", 0, state = "recording")
        assertEquals(0, db.flights().deleteIfFullySynced("f2"))
    }

    @Test fun rejectedSamplesAreKeptAndNotPending() = runBlocking {
        db.seedFlight("f1", 2)
        db.samples().assignBatch("b1", listOf("s-f1-0", "s-f1-1"))
        db.samples().markRejected("f1", "b1", 0, "invalid_speed")
        assertEquals(1, db.samples().pendingCount())
        assertEquals(2, db.samples().forFlight("f1").size)
    }

    @Test fun markSyncedOnlyTouchesTheBatchesOwnSamples() = runBlocking {
        db.seedFlight("f1", 3)
        db.samples().assignBatch("b1", listOf("s-f1-0"))
        db.samples().markSynced("f1", "b1", listOf(0, 1, 2)) // seq 1 and 2 are not in the batch
        assertEquals(2, db.samples().pendingCount())
    }
}
