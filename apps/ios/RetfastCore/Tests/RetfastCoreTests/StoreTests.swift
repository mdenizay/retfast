import Foundation
import GRDB
import Testing
@testable import RetfastCore

@Suite("Local telemetry store")
struct LocalTelemetryStoreTests {
    @Test func insertAssignsMonotonicSeqAcrossReopen() throws {
        let url = Fixtures.tempURL()
        let flight = Fixtures.flight()
        do {
            let store = try LocalTelemetryStore.open(at: url)
            try store.insertFlight(flight)
            for i in 0..<5 { try store.append(Fixtures.newSample(i), flightId: flight.id) }
        }
        let store = try LocalTelemetryStore.open(at: url)
        let s = try store.append(Fixtures.newSample(5), flightId: flight.id)
        #expect(s.seq == 5)
        #expect(try store.samples(flightId: flight.id).map(\.seq) == [0, 1, 2, 3, 4, 5])
        #expect(try store.pendingCount() == 6)
        #expect(try store.pendingCount(flightId: UUID()) == 0)
        #expect(store.databaseSizeBytes() > 0)
        // WAL mode is on.
        let mode = try store.writer.read { db in try String.fetchOne(db, sql: "PRAGMA journal_mode") }
        #expect(mode == "wal")
    }

    @Test func rawValuesKeptAndLowQualityFlagged() throws {
        let store = try Fixtures.store()
        let flight = Fixtures.flight()
        try store.insertFlight(flight)
        let s = try store.append(Fixtures.newSample(0, hAcc: 75), flightId: flight.id)
        #expect(s.hAcc == 75)
        #expect(s.lowQuality)
        #expect(s.altitude == 2100)
        #expect(s.battery == 0.8)
    }

    @Test func batchesOnlyForServerKnownFlightsAndReuseId() throws {
        let store = try Fixtures.store()
        let flight = Fixtures.flight(serverCreated: false)
        try store.insertFlight(flight)
        for i in 0..<7 { try store.append(Fixtures.newSample(i), flightId: flight.id) }
        #expect(try store.nextBatch(maxSamples: 3) == nil)
        try store.updateFlight(id: flight.id) { $0.serverCreated = true }

        let b1 = try #require(try store.nextBatch(maxSamples: 3))
        #expect(b1.samples.map(\.seq) == [0, 1, 2])
        // Not acknowledged yet → the same batch (same id, same samples) comes back.
        let again = try #require(try store.nextBatch(maxSamples: 3))
        #expect(again.batch.id == b1.batch.id)
        #expect(again.samples.map(\.seq) == [0, 1, 2])
    }

    @Test func marksSyncedOnlyAcknowledgedSeqsOfTheBatch() throws {
        let store = try Fixtures.store()
        let flight = Fixtures.flight(serverCreated: true)
        try store.insertFlight(flight)
        for i in 0..<6 { try store.append(Fixtures.newSample(i), flightId: flight.id) }
        let b = try #require(try store.nextBatch(maxSamples: 4)) // seqs 0...3
        // Server: 0 accepted, 1 duplicate, 2 rejected, 3 not mentioned; 5 is not in this batch.
        try store.applyBatchResult(batchId: b.batch.id, acknowledged: [0, 1, 5], rejected: [(2, "invalid_speed")], ackTime: Fixtures.t0)
        let samples = try store.samples(flightId: flight.id)
        #expect(samples.map(\.syncState) == [.synced, .synced, .rejected, .pending, .pending, .pending])
        #expect(samples[2].rejectReason == "invalid_speed")
        #expect(samples.allSatisfy { $0.batchId == nil })
        #expect(try store.pendingCount() == 3)
        #expect(try store.lastServerAck() == Fixtures.t0)
        // Unmentioned seq 3 is released into the next new batch.
        let next = try #require(try store.nextBatch(maxSamples: 10))
        #expect(next.batch.id != b.batch.id)
        #expect(next.samples.map(\.seq) == [3, 4, 5])
    }

    @Test func pruneNeverDeletesUnsynced() throws {
        let store = try Fixtures.store()
        var flights: [LocalFlight] = []
        for k in 0..<3 {
            var f = Fixtures.flight(serverCreated: true, state: .completed, startedAt: Fixtures.t0.addingTimeInterval(Double(k) * 3600))
            f.serverEnded = true
            try store.insertFlight(f)
            for i in 0..<4 { try store.append(Fixtures.newSample(i), flightId: f.id) }
            flights.append(f)
        }
        // Oldest flight: 2 synced, 2 pending. Middle: all synced.
        let b = try #require(try store.nextBatch(maxSamples: 2))
        #expect(b.batch.flightId == flights[0].id)
        try store.applyBatchResult(batchId: b.batch.id, acknowledged: [0, 1], rejected: [], ackTime: Fixtures.t0)
        // Middle and newest flights: everything synced.
        try store.writer.write { db in
            try db.execute(sql: "UPDATE sample SET syncState = 1 WHERE flightId IN (?, ?)", arguments: [flights[1].id, flights[2].id])
        }
        // An in-flight batch on the oldest flight's pending samples must survive too.
        _ = try store.nextBatch(maxSamples: 10)
        let deleted = try store.prune(keepRecentFlights: 1)
        #expect(deleted == 2 + 4)  // oldest: 2 synced; middle: 4 synced; newest kept
        let oldest = try store.samples(flightId: flights[0].id)
        #expect(oldest.count == 2)
        #expect(oldest.allSatisfy { $0.syncState == .pending })
        #expect(try store.samples(flightId: flights[2].id).count == 4)
    }

    @Test func migratesFromV1KeepingData() throws {
        let url = Fixtures.tempURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let flight = Fixtures.flight()
        do {
            let pool = try DatabasePool(path: url.path)
            try LocalTelemetryStore.migrator.migrate(pool, upTo: "v1_flights_samples")
            let old = LocalTelemetryStore(writer: pool, url: url, recoveryEvent: nil)
            try old.insertFlight(flight)
            try old.append(Fixtures.newSample(0), flightId: flight.id)
            #expect(try old.appliedMigrations() == ["v1_flights_samples"])
        }
        let store = try LocalTelemetryStore.open(at: url)
        #expect(try store.appliedMigrations() == ["v1_flights_samples", "v2_incidents_kv"])
        #expect(try store.samples(flightId: flight.id).count == 1)
        #expect(store.recoveryEvent == nil)
    }

    @Test func corruptFileIsQuarantinedNotDeleted() throws {
        let url = Fixtures.tempURL()
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let garbage = Data((0..<8192).map { UInt8(truncatingIfNeeded: $0 &* 31 &+ 7) })
        try garbage.write(to: url)

        let store = try LocalTelemetryStore.open(at: url)
        let event = try #require(store.recoveryEvent)
        #expect(FileManager.default.fileExists(atPath: event.quarantinedPath))
        #expect(try Data(contentsOf: URL(fileURLWithPath: event.quarantinedPath)) == garbage)
        // The new database works and remembers the recovery for diagnostics.
        try store.insertFlight(Fixtures.flight())
        #expect(store.recoveryHistory().count == 1)
        let reopened = try LocalTelemetryStore.open(at: url)
        #expect(reopened.recoveryEvent == nil)
        #expect(reopened.recoveryHistory().first?.quarantinedPath == event.quarantinedPath)
    }

    @Test func activeFlightForRestore() throws {
        let store = try Fixtures.store()
        try store.insertFlight(Fixtures.flight(state: .completed))
        #expect(try store.activeFlight() == nil)
        let active = Fixtures.flight(state: .paused, startedAt: Fixtures.t0.addingTimeInterval(10))
        try store.insertFlight(active)
        #expect(try store.activeFlight()?.id == active.id)
    }

    @Test func gpxExport() throws {
        let s = TelemetrySample(flightId: UUID(), seq: 0, t: Fixtures.t0, deviceT: Fixtures.t0, lat: 37.1234567, lon: 29.5,
                                altitude: 1500.25, hAcc: 5, vAcc: 3, speed: 3, course: 1, profile: "cruise",
                                battery: nil, lowPower: false, lowQuality: false)
        let gpx = GPXExporter.gpx(flightName: "Test & <flight>", samples: [s], isSimulated: true)
        #expect(gpx.contains("<trkpt lat=\"37.1234567\" lon=\"29.5000000\"><ele>1500.2</ele>") || gpx.contains("<ele>1500.3</ele>"))
        #expect(gpx.contains("Not a certified flight log"))
        #expect(gpx.contains("Test &amp; &lt;flight&gt;"))
        #expect(gpx.contains("SIMULATED"))
    }
}
