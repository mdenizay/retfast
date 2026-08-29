import Foundation
import SQLite3

/// Durable local queue for location points (docs/ios-tracking.md).
/// Every captured point is written here *before* any upload attempt; the
/// client-generated UUID makes server ingestion idempotent.
final class PointBuffer {
    static let shared = PointBuffer()

    struct PendingPoint {
        let id: String
        let payload: [String: Any]
    }

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.mizibu.retfast.pointbuffer")

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("points.sqlite").path
        if sqlite3_open(path, &db) == SQLITE_OK {
            exec("PRAGMA journal_mode=WAL")
            exec("""
                CREATE TABLE IF NOT EXISTS pending_points(
                  id TEXT PRIMARY KEY,
                  payload TEXT NOT NULL,
                  created_at INTEGER NOT NULL,
                  in_flight INTEGER NOT NULL DEFAULT 0
                )
                """)
            // Recover after termination: anything left in-flight goes back to pending.
            exec("UPDATE pending_points SET in_flight = 0")
        }
    }

    private func exec(_ sql: String) {
        sqlite3_exec(db, sql, nil, nil, nil)
    }

    /// Hard ceiling on queued points (~15 MB). A device that has been offline
    /// for days must not grow the buffer until iOS kills the app for memory —
    /// the oldest fixes are the least operationally useful, so they go first.
    private static let maxQueued = 50_000
    private var insertsSincePrune = 0

    func enqueue(id: UUID, payload: [String: Any]) {
        queue.sync {
            guard let json = try? JSONSerialization.data(withJSONObject: payload),
                  let text = String(data: json, encoding: .utf8) else { return }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(
                db,
                "INSERT OR IGNORE INTO pending_points(id, payload, created_at) VALUES(?,?,?)",
                -1, &stmt, nil
            ) == SQLITE_OK else { return }
            sqlite3_bind_text(stmt, 1, id.uuidString, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            sqlite3_bind_text(stmt, 2, text, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            sqlite3_bind_int64(stmt, 3, Int64(Date().timeIntervalSince1970))
            sqlite3_step(stmt)

            insertsSincePrune += 1
            if insertsSincePrune >= 500 {
                insertsSincePrune = 0
                exec("""
                    DELETE FROM pending_points WHERE id IN (
                      SELECT id FROM pending_points ORDER BY created_at DESC
                      LIMIT -1 OFFSET \(Self.maxQueued)
                    )
                    """)
            }
        }
    }

    /// Oldest pending points, marked in-flight until confirmed or reset.
    func checkoutBatch(limit: Int) -> [PendingPoint] {
        queue.sync {
            var result: [PendingPoint] = []
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(
                db,
                "SELECT id, payload FROM pending_points WHERE in_flight = 0 ORDER BY created_at LIMIT ?",
                -1, &stmt, nil
            ) == SQLITE_OK else { return [] }
            sqlite3_bind_int(stmt, 1, Int32(limit))
            while sqlite3_step(stmt) == SQLITE_ROW {
                guard let idC = sqlite3_column_text(stmt, 0),
                      let payloadC = sqlite3_column_text(stmt, 1) else { continue }
                let id = String(cString: idC)
                let text = String(cString: payloadC)
                if let data = text.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    result.append(PendingPoint(id: id, payload: obj))
                }
            }
            if !result.isEmpty {
                let ids = result.map { "'\($0.id)'" }.joined(separator: ",")
                exec("UPDATE pending_points SET in_flight = 1 WHERE id IN (\(ids))")
            }
            return result
        }
    }

    func confirm(ids: [String]) {
        guard !ids.isEmpty else { return }
        queue.sync {
            let list = ids.map { "'\($0)'" }.joined(separator: ",")
            exec("DELETE FROM pending_points WHERE id IN (\(list))")
        }
    }

    func rollback(ids: [String]) {
        guard !ids.isEmpty else { return }
        queue.sync {
            let list = ids.map { "'\($0)'" }.joined(separator: ",")
            exec("UPDATE pending_points SET in_flight = 0 WHERE id IN (\(list))")
        }
    }

    var pendingCount: Int {
        queue.sync {
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM pending_points", -1, &stmt, nil) == SQLITE_OK,
                  sqlite3_step(stmt) == SQLITE_ROW else { return 0 }
            return Int(sqlite3_column_int(stmt, 0))
        }
    }
}
