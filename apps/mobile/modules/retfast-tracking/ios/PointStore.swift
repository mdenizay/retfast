import Foundation
import SQLite3

/// Dayanıklı yerel konum kuyruğu. Her nokta ağ denemesinden ÖNCE buraya yazılır; cihaz yalnızca sunucu 200
/// döndükten sonra siler. (session_id, t) benzersizdir: aynı fix iki kez kuyruğa girmez, sunucuda da
/// (event, user, recorded_at) birincil anahtarı tekrarı engeller.
final class PointStore {
    static let shared = PointStore()

    struct Pending {
        let rowid: Int64
        let point: [String: Any]
    }

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.mizibu.retfast.pointstore")
    /// Birkaç gün çevrimdışı kalan cihaz belleği tüketmesin; en eski noktalar en az değerlidir, onlar gider.
    private static let maxQueued = 50_000
    private var insertsSincePrune = 0
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("retfast-points.sqlite").path
        guard sqlite3_open(path, &db) == SQLITE_OK else { return }
        exec("PRAGMA journal_mode=WAL")
        exec("PRAGMA synchronous=NORMAL")
        exec("""
            CREATE TABLE IF NOT EXISTS pending(
              rowid INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              t INTEGER NOT NULL,
              payload TEXT NOT NULL,
              in_flight INTEGER NOT NULL DEFAULT 0,
              UNIQUE(session_id, t)
            )
            """)
        // Sonlandırma sırasında yarıda kalan yüklemeler tekrar bekleyen olur.
        exec("UPDATE pending SET in_flight = 0")
    }

    private func exec(_ sql: String) { sqlite3_exec(db, sql, nil, nil, nil) }

    func enqueue(sessionId: String, t: Int64, point: [String: Any]) {
        queue.sync {
            guard let json = try? JSONSerialization.data(withJSONObject: point), let text = String(data: json, encoding: .utf8) else { return }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "INSERT OR IGNORE INTO pending(session_id, t, payload) VALUES(?,?,?)", -1, &stmt, nil) == SQLITE_OK else { return }
            sqlite3_bind_text(stmt, 1, sessionId, -1, Self.transient)
            sqlite3_bind_int64(stmt, 2, t)
            sqlite3_bind_text(stmt, 3, text, -1, Self.transient)
            sqlite3_step(stmt)
            insertsSincePrune += 1
            if insertsSincePrune >= 500 {
                insertsSincePrune = 0
                exec("DELETE FROM pending WHERE rowid IN (SELECT rowid FROM pending ORDER BY t DESC LIMIT -1 OFFSET \(Self.maxQueued))")
            }
        }
    }

    /// En eski bekleyen noktalar; yükleme bitene kadar `in_flight` işaretli kalır.
    func checkout(sessionId: String, limit: Int) -> [Pending] {
        queue.sync {
            var result: [Pending] = []
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT rowid, payload FROM pending WHERE session_id = ? AND in_flight = 0 ORDER BY t LIMIT ?", -1, &stmt, nil) == SQLITE_OK else { return [] }
            sqlite3_bind_text(stmt, 1, sessionId, -1, Self.transient)
            sqlite3_bind_int(stmt, 2, Int32(limit))
            while sqlite3_step(stmt) == SQLITE_ROW {
                let rowid = sqlite3_column_int64(stmt, 0)
                guard let c = sqlite3_column_text(stmt, 1), let data = String(cString: c).data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                result.append(Pending(rowid: rowid, point: obj))
            }
            if !result.isEmpty { exec("UPDATE pending SET in_flight = 1 WHERE rowid IN (\(result.map { String($0.rowid) }.joined(separator: ",")))") }
            return result
        }
    }

    func confirm(_ rowids: [Int64]) {
        guard !rowids.isEmpty else { return }
        queue.sync { exec("DELETE FROM pending WHERE rowid IN (\(rowids.map(String.init).joined(separator: ",")))") }
    }

    func rollback(_ rowids: [Int64]) {
        guard !rowids.isEmpty else { return }
        queue.sync { exec("UPDATE pending SET in_flight = 0 WHERE rowid IN (\(rowids.map(String.init).joined(separator: ",")))") }
    }

    /// Kapanmış bir oturumun noktaları sunucuda asla kabul edilmez; kuyrukta bekletme.
    func purge(sessionId: String) {
        queue.sync {
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "DELETE FROM pending WHERE session_id = ?", -1, &stmt, nil) == SQLITE_OK else { return }
            sqlite3_bind_text(stmt, 1, sessionId, -1, Self.transient)
            sqlite3_step(stmt)
        }
    }

    var pendingCount: Int {
        queue.sync {
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM pending", -1, &stmt, nil) == SQLITE_OK, sqlite3_step(stmt) == SQLITE_ROW else { return 0 }
            return Int(sqlite3_column_int(stmt, 0))
        }
    }
}
