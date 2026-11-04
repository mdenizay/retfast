import Foundation
import GRDB
import os

/// SQLite (GRDB, WAL) persistence for flights, samples, outbound batches and SOS
/// incidents. Every accepted GPS sample is written here *before* any network use.
///
/// Invariants:
/// - `seq` is assigned inside the insert transaction from `flight.nextSeq`, so it
///   is strictly monotonic per flight across crashes and relaunches.
/// - Pending (unsynced) samples are never deleted by this type. Pruning only
///   removes `synced` samples of old, completed, server-ended flights.
/// - A sample's `batchId` is immutable while assigned, so retrying a batch_id
///   always sends exactly the same samples (server idempotency relies on that).
public final class LocalTelemetryStore: Sendable {
    public let writer: any DatabaseWriter
    public let url: URL?
    /// Set when the database was found damaged on open and replaced.
    public let recoveryEvent: StoreRecoveryEvent?

    private static let log = Logger(subsystem: "com.mizibu.retfast", category: "store")

    init(writer: any DatabaseWriter, url: URL?, recoveryEvent: StoreRecoveryEvent?) {
        self.writer = writer
        self.url = url
        self.recoveryEvent = recoveryEvent
    }

    // MARK: Opening & recovery

    /// Opens (or creates) the database at `url`. If the existing file cannot be
    /// opened, fails the integrity check, or cannot be migrated, it is moved
    /// aside (never deleted) and a fresh database is created; the event is
    /// returned in `recoveryEvent` and persisted for the diagnostics screen.
    public static func open(at url: URL, now: Date = Date()) throws -> LocalTelemetryStore {
        let fm = FileManager.default
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        // Recording continues while the phone is locked: the file must stay
        // writable after first unlock. (.complete would break background writes.)
        try? fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                              ofItemAtPath: url.deletingLastPathComponent().path)
        #endif

        if fm.fileExists(atPath: url.path) {
            do {
                let pool = try openPool(url)
                return LocalTelemetryStore(writer: pool, url: url, recoveryEvent: nil)
            } catch {
                log.error("database open failed, quarantining: \(String(describing: error), privacy: .public)")
                let quarantined = try quarantine(url, now: now)
                let event = StoreRecoveryEvent(occurredAt: now, reason: String(describing: error), quarantinedPath: quarantined.path)
                let pool = try openPool(url)
                let store = LocalTelemetryStore(writer: pool, url: url, recoveryEvent: event)
                try? store.appendRecoveryEvent(event)
                return store
            }
        }
        let pool = try openPool(url)
        return LocalTelemetryStore(writer: pool, url: url, recoveryEvent: nil)
    }

    /// In-memory store for previews and tests that don't need a file.
    public static func inMemory() throws -> LocalTelemetryStore {
        let queue = try DatabaseQueue(configuration: configuration())
        try migrator.migrate(queue)
        return LocalTelemetryStore(writer: queue, url: nil, recoveryEvent: nil)
    }

    static func configuration() -> Configuration {
        var config = Configuration()
        config.foreignKeysEnabled = true
        config.busyMode = .timeout(5)
        config.label = "retfast.store"
        return config
    }

    static func openPool(_ url: URL) throws -> DatabasePool {
        let pool = try DatabasePool(path: url.path, configuration: configuration())
        // quick_check is O(N) but skips index cross-checks; integrity_check is
        // too slow to run on every launch with large tracks.
        let result = try pool.read { db in try String.fetchOne(db, sql: "PRAGMA quick_check") }
        guard result == "ok" else { throw StoreError.integrityCheckFailed(result ?? "nil") }
        try migrator.migrate(pool)
        return pool
    }

    static func quarantine(_ url: URL, now: Date) throws -> URL {
        let fm = FileManager.default
        let stamp = ISO8601DateFormatter().string(from: now).replacingOccurrences(of: ":", with: "-")
        let base = url.deletingPathExtension().lastPathComponent
        let target = url.deletingLastPathComponent().appendingPathComponent("\(base).corrupt-\(stamp).sqlite")
        try fm.moveItem(at: url, to: target)
        for suffix in ["-wal", "-shm"] {
            let side = URL(fileURLWithPath: url.path + suffix)
            if fm.fileExists(atPath: side.path) {
                try? fm.moveItem(at: side, to: URL(fileURLWithPath: target.path + suffix))
            }
        }
        return target
    }

    public enum StoreError: Error, Equatable {
        case integrityCheckFailed(String)
        case flightNotFound
    }

    // MARK: Schema

    static var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1_flights_samples") { db in
            try db.create(table: "flight") { t in
                t.primaryKey("id", .blob)
                t.column("eventId", .blob)
                t.column("eventName", .text)
                t.column("visibility", .text).notNull()
                t.column("isSimulated", .boolean).notNull().defaults(to: false)
                t.column("startedAt", .datetime).notNull()
                t.column("endedAt", .datetime)
                t.column("state", .text).notNull()
                t.column("serverCreated", .boolean).notNull().defaults(to: false)
                t.column("serverEnded", .boolean).notNull().defaults(to: false)
                t.column("nextSeq", .integer).notNull().defaults(to: 0)
                t.column("lastSampleAt", .datetime)
                t.column("profile", .text).notNull()
                t.column("interruptionCount", .integer).notNull().defaults(to: 0)
                t.column("lastError", .text)
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }
            try db.create(table: "sample") { t in
                t.primaryKey("id", .blob)
                t.column("flightId", .blob).notNull().references("flight", onDelete: .restrict)
                t.column("seq", .integer).notNull()
                t.column("t", .datetime).notNull()
                t.column("deviceT", .datetime).notNull()
                t.column("lat", .double).notNull()
                t.column("lon", .double).notNull()
                t.column("altitude", .double)
                t.column("ellipsoidalAltitude", .double)
                t.column("hAcc", .double).notNull()
                t.column("vAcc", .double)
                t.column("speed", .double)
                t.column("course", .double)
                t.column("floor", .integer)
                t.column("profile", .text).notNull()
                t.column("battery", .double)
                t.column("lowPower", .boolean).notNull()
                t.column("lowQuality", .boolean).notNull()
                t.column("isSimulatedBySoftware", .boolean).notNull().defaults(to: false)
                t.column("syncState", .integer).notNull().defaults(to: 0)
                t.column("rejectReason", .text)
                t.column("batchId", .blob)
                t.uniqueKey(["flightId", "seq"])
            }
            try db.create(index: "sample_sync", on: "sample", columns: ["syncState", "flightId", "seq"])
            try db.create(index: "sample_batch", on: "sample", columns: ["batchId"])
            try db.create(table: "outbox_batch") { t in
                t.primaryKey("id", .blob)
                t.column("flightId", .blob).notNull().references("flight", onDelete: .restrict)
                t.column("createdAt", .datetime).notNull()
                t.column("attemptCount", .integer).notNull().defaults(to: 0)
                t.column("lastAttemptAt", .datetime)
                t.column("lastError", .text)
            }
        }
        m.registerMigration("v2_incidents_kv") { db in
            try db.create(table: "incident") { t in
                t.primaryKey("id", .blob)
                t.column("flightId", .blob)
                t.column("eventId", .blob)
                t.column("isTest", .boolean).notNull()
                t.column("lat", .double)
                t.column("lon", .double)
                t.column("altitude", .double)
                t.column("hAcc", .double)
                t.column("positionTime", .datetime)
                t.column("message", .text).notNull().defaults(to: "")
                t.column("createdAtDevice", .datetime).notNull()
                t.column("deliveryState", .text).notNull()
                t.column("serverStatus", .text)
                t.column("receivedAt", .datetime)
                t.column("acknowledgedAt", .datetime)
                t.column("acknowledgedByName", .text)
                t.column("cancelRequested", .boolean).notNull().defaults(to: false)
                t.column("cancelSynced", .boolean).notNull().defaults(to: false)
                t.column("attemptCount", .integer).notNull().defaults(to: 0)
                t.column("lastAttemptAt", .datetime)
                t.column("lastError", .text)
                t.column("updatedAt", .datetime).notNull()
            }
            try db.create(table: "kv") { t in
                t.primaryKey("key", .text)
                t.column("value", .text).notNull()
            }
        }
        return m
    }

    public func appliedMigrations() throws -> [String] {
        try writer.read { db in try Self.migrator.appliedIdentifiers(db).sorted() }
    }

    // MARK: Flights

    public func insertFlight(_ flight: LocalFlight) throws {
        try writer.write { db in try flight.insert(db) }
    }

    public func flight(id: UUID) throws -> LocalFlight? {
        try writer.read { db in try LocalFlight.fetchOne(db, key: id) }
    }

    /// The flight that must be restored on launch, if any (most recent first).
    public func activeFlight() throws -> LocalFlight? {
        try writer.read { db in
            try LocalFlight
                .filter([FlightSessionState.preparing, .recording, .paused, .ending].map(\.rawValue).contains(Column("state")))
                .order(Column("startedAt").desc)
                .fetchOne(db)
        }
    }

    public func recentFlights(limit: Int = 50) throws -> [LocalFlight] {
        try writer.read { db in
            try LocalFlight.order(Column("startedAt").desc).limit(limit).fetchAll(db)
        }
    }

    public func updateFlight(id: UUID, _ change: @Sendable (inout LocalFlight) -> Void, now: Date = Date()) throws {
        try writer.write { db in
            guard var f = try LocalFlight.fetchOne(db, key: id) else { throw StoreError.flightNotFound }
            change(&f)
            f.updatedAt = now
            try f.update(db)
        }
    }

    public func flightsNeedingServerCreate() throws -> [LocalFlight] {
        try writer.read { db in
            try LocalFlight.filter(Column("serverCreated") == false).order(Column("startedAt")).fetchAll(db)
        }
    }

    public func flightsNeedingServerEnd() throws -> [LocalFlight] {
        try writer.read { db in
            try LocalFlight
                .filter(Column("serverCreated") == true && Column("serverEnded") == false
                        && Column("state") == FlightSessionState.completed.rawValue && Column("endedAt") != nil)
                .fetchAll(db)
        }
    }

    // MARK: Samples

    /// Persist an accepted fix. Assigns the next `seq` in the same transaction.
    @discardableResult
    public func append(_ new: NewSample, flightId: UUID) throws -> TelemetrySample {
        try writer.write { db in
            guard var flight = try LocalFlight.fetchOne(db, key: flightId) else { throw StoreError.flightNotFound }
            let raw = new.raw
            let sample = TelemetrySample(
                flightId: flightId, seq: flight.nextSeq, t: raw.timestamp, deviceT: new.deviceT,
                lat: raw.latitude, lon: raw.longitude,
                altitude: raw.verticalAccuracy > 0 && raw.altitude.isFinite ? raw.altitude : nil,
                ellipsoidalAltitude: raw.ellipsoidalAltitude.flatMap { $0.isFinite ? $0 : nil },
                hAcc: raw.horizontalAccuracy,
                vAcc: raw.verticalAccuracy > 0 ? raw.verticalAccuracy : nil,
                speed: raw.speed >= 0 ? raw.speed : nil,
                course: raw.course >= 0 ? raw.course : nil,
                floor: raw.floor, profile: new.profile.rawValue,
                battery: new.conditions.batteryLevel, lowPower: new.conditions.lowPowerMode,
                lowQuality: new.lowQuality, isSimulatedBySoftware: raw.isSimulatedBySoftware)
            try sample.insert(db)
            flight.nextSeq += 1
            flight.lastSampleAt = raw.timestamp
            flight.profile = new.profile.rawValue
            flight.updatedAt = new.deviceT
            try flight.update(db)
            return sample
        }
    }

    public func samples(flightId: UUID, afterSeq: Int = -1, limit: Int? = nil) throws -> [TelemetrySample] {
        try writer.read { db in
            var request = TelemetrySample
                .filter(Column("flightId") == flightId && Column("seq") > afterSeq)
                .order(Column("seq"))
            if let limit { request = request.limit(limit) }
            return try request.fetchAll(db)
        }
    }

    /// Most recent sample the server has acknowledged (for "last synced position").
    public func lastSyncedSample(flightId: UUID) throws -> TelemetrySample? {
        try writer.read { db in
            try TelemetrySample
                .filter(Column("flightId") == flightId && Column("syncState") == SampleSyncState.synced.rawValue)
                .order(Column("seq").desc).fetchOne(db)
        }
    }

    public func pendingCount(flightId: UUID? = nil) throws -> Int {
        try writer.read { db in
            var request = TelemetrySample.filter(Column("syncState") == SampleSyncState.pending.rawValue)
            if let flightId { request = request.filter(Column("flightId") == flightId) }
            return try request.fetchCount(db)
        }
    }

    public struct SyncCounts: Sendable, Equatable {
        public var pending = 0, synced = 0, rejected = 0
        public var total: Int { pending + synced + rejected }
        public init(pending: Int = 0, synced: Int = 0, rejected: Int = 0) {
            self.pending = pending; self.synced = synced; self.rejected = rejected
        }
    }

    public func syncCounts(flightId: UUID) throws -> SyncCounts {
        try writer.read { db in
            var c = SyncCounts()
            let rows = try Row.fetchAll(db, sql: "SELECT syncState, COUNT(*) AS n FROM sample WHERE flightId = ? GROUP BY syncState", arguments: [flightId])
            for row in rows {
                switch SampleSyncState(rawValue: row["syncState"]) {
                case .pending: c.pending = row["n"]
                case .synced: c.synced = row["n"]
                case .rejected: c.rejected = row["n"]
                case nil: break
                }
            }
            return c
        }
    }

    /// Returns the next batch to send: an existing (retried) batch first, with
    /// the same id and samples; otherwise a new batch of up to `maxSamples`
    /// pending, unassigned samples of one server-known flight.
    public func nextBatch(maxSamples: Int = 500, now: Date = Date()) throws -> PreparedBatch? {
        try writer.write { db in
            if let existing = try OutboxBatch.order(Column("createdAt")).fetchOne(db) {
                let samples = try TelemetrySample
                    .filter(Column("batchId") == existing.id && Column("syncState") == SampleSyncState.pending.rawValue)
                    .order(Column("seq")).fetchAll(db)
                if !samples.isEmpty { return PreparedBatch(batch: existing, samples: samples) }
                try existing.delete(db)
            }
            let flightId = try UUID.fetchOne(db, sql: """
                SELECT s.flightId FROM sample s JOIN flight f ON f.id = s.flightId
                WHERE s.syncState = 0 AND s.batchId IS NULL AND f.serverCreated = 1
                ORDER BY f.startedAt, s.seq LIMIT 1
                """)
            guard let flightId else { return nil }
            let batch = OutboxBatch(id: UUID(), flightId: flightId, createdAt: now, attemptCount: 0, lastAttemptAt: nil, lastError: nil)
            try batch.insert(db)
            try db.execute(sql: """
                UPDATE sample SET batchId = ? WHERE id IN (
                  SELECT id FROM sample WHERE flightId = ? AND syncState = 0 AND batchId IS NULL ORDER BY seq LIMIT ?)
                """, arguments: [batch.id, flightId, maxSamples])
            let samples = try TelemetrySample.filter(Column("batchId") == batch.id).order(Column("seq")).fetchAll(db)
            return PreparedBatch(batch: batch, samples: samples)
        }
    }

    public func recordBatchAttempt(_ batchId: UUID, error: String?, at: Date = Date()) throws {
        try writer.write { db in
            guard var b = try OutboxBatch.fetchOne(db, key: batchId) else { return }
            b.attemptCount += 1
            b.lastAttemptAt = at
            b.lastError = error
            try b.update(db)
        }
    }

    /// Apply a server response. Only seqs that are both in `accepted ∪ duplicate`
    /// *and* belong to this batch are marked synced. Samples of the batch the
    /// server did not mention stay pending and are released for a new batch.
    public func applyBatchResult(batchId: UUID, acknowledged: [Int], rejected: [(seq: Int, reason: String)], ackTime: Date) throws {
        try writer.write { db in
            guard let batch = try OutboxBatch.fetchOne(db, key: batchId) else { return }
            let acked = Set(acknowledged)
            let rejectedMap = Dictionary(rejected.map { ($0.seq, $0.reason) }, uniquingKeysWith: { a, _ in a })
            let samples = try TelemetrySample.filter(Column("batchId") == batchId).fetchAll(db)
            for var s in samples {
                if acked.contains(s.seq) {
                    s.syncState = .synced
                } else if let reason = rejectedMap[s.seq] {
                    s.syncState = .rejected
                    s.rejectReason = reason
                }
                s.batchId = nil
                try s.update(db)
            }
            try batch.delete(db)
            if !acked.isEmpty {
                try db.execute(sql: "INSERT OR REPLACE INTO kv(key, value) VALUES ('lastServerAck', ?)",
                               arguments: [ackTime.timeIntervalSince1970.description])
            }
        }
    }

    /// The server refused the batch as a whole (4xx validation): mark its
    /// samples rejected (kept locally) so the queue does not jam forever.
    public func rejectBatch(batchId: UUID, reason: String) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE sample SET syncState = 2, rejectReason = ?, batchId = NULL WHERE batchId = ? AND syncState = 0",
                           arguments: [reason, batchId])
            _ = try OutboxBatch.deleteOne(db, key: batchId)
        }
    }

    public func lastServerAck() throws -> Date? {
        try writer.read { db in
            try String.fetchOne(db, sql: "SELECT value FROM kv WHERE key = 'lastServerAck'")
                .flatMap(Double.init).map(Date.init(timeIntervalSince1970:))
        }
    }

    // MARK: Pruning

    /// Delete *synced* samples of completed, server-ended flights beyond the
    /// `keepRecentFlights` most recent ones. Pending and rejected samples are
    /// never touched. Returns the number of deleted samples.
    @discardableResult
    public func prune(keepRecentFlights: Int) throws -> Int {
        try writer.write { db in
            let keep = try UUID.fetchAll(db, sql: "SELECT id FROM flight ORDER BY startedAt DESC LIMIT ?", arguments: [keepRecentFlights])
            let candidates = try UUID.fetchAll(db, sql: "SELECT id FROM flight WHERE state = 'completed' AND serverEnded = 1")
                .filter { !keep.contains($0) }
            var deleted = 0
            for id in candidates {
                try db.execute(sql: "DELETE FROM sample WHERE flightId = ? AND syncState = 1 AND batchId IS NULL", arguments: [id])
                deleted += db.changesCount
            }
            return deleted
        }
    }

    public func databaseSizeBytes() -> Int64 {
        guard let url else { return 0 }
        let fm = FileManager.default
        return ["", "-wal", "-shm"].reduce(Int64(0)) { total, suffix in
            let size = (try? fm.attributesOfItem(atPath: url.path + suffix)[.size] as? NSNumber)?.int64Value ?? 0
            return total + size
        }
    }

    // MARK: Incidents

    public func saveIncident(_ incident: LocalIncident) throws {
        try writer.write { db in try incident.save(db) }
    }

    public func incident(id: UUID) throws -> LocalIncident? {
        try writer.read { db in try LocalIncident.fetchOne(db, key: id) }
    }

    public func incidents(limit: Int = 50) throws -> [LocalIncident] {
        try writer.read { db in try LocalIncident.order(Column("createdAtDevice").desc).limit(limit).fetchAll(db) }
    }

    // MARK: Key-value & diagnostics

    public func setValue(_ value: String?, forKey key: String) throws {
        try writer.write { db in
            if let value {
                try db.execute(sql: "INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)", arguments: [key, value])
            } else {
                try db.execute(sql: "DELETE FROM kv WHERE key = ?", arguments: [key])
            }
        }
    }

    public func value(forKey key: String) throws -> String? {
        try writer.read { db in try String.fetchOne(db, sql: "SELECT value FROM kv WHERE key = ?", arguments: [key]) }
    }

    func appendRecoveryEvent(_ event: StoreRecoveryEvent) throws {
        var events = recoveryHistory()
        events.append(event)
        let data = try JSONEncoder().encode(events.suffix(10))
        try setValue(String(decoding: data, as: UTF8.self), forKey: "recoveryEvents")
    }

    /// All recorded database recoveries (survive relaunch; surfaced in diagnostics).
    public func recoveryHistory() -> [StoreRecoveryEvent] {
        guard let json = try? value(forKey: "recoveryEvents"),
              let events = try? JSONDecoder().decode([StoreRecoveryEvent].self, from: Data(json.utf8)) else { return [] }
        return events
    }
}
