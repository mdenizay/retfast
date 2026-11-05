#if DEBUG
import Foundation
import RetfastCore

/// In-process fake backend for UI tests (`-stubAPI`). Implements just enough
/// of api-contract.md for: login → events → flight + telemetry → retrieval.
/// The stub accepts a retrieval ~4 s after it is created (as "Kübra").
/// DEBUG builds only; never compiled into Release.
final class StubBackend: URLProtocol, @unchecked Sendable {
    static let eventId = "0b6c1a52-3f39-4d7e-9b2a-6f5b1c2d3e4f"
    private static let state = LockedBox(State())

    struct State {
        var retrievals: [String: (json: [String: Any], createdAt: Date, cancelled: Bool)] = [:]
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubBackend.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        guard let url = request.url else { return }
        let body = request.httpBody ?? Self.read(request.httpBodyStream)
        let json = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let (status, object) = Self.route(method: request.httpMethod ?? "GET", path: url.path, json: json)
        let data = object.flatMap { try? JSONSerialization.data(withJSONObject: $0) } ?? Data()
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json", "X-Request-Id": "stub"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    static func read(_ stream: InputStream?) -> Data? {
        guard let stream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }

    static func now() -> String { JSONCoding.formatDate(Date()) }

    nonisolated(unsafe) static let me: [String: Any] = [
        "id": "00000000-0000-4000-8000-000000000001", "email": "pilot@stub.local", "email_verified": true,
        "full_name": "Stub Pilot", "roles": [], "must_change_password": false, "created_at": "2026-11-01T10:00:00.000Z",
        "pilot": ["public_id": "stub", "display_name": "Stub Pilot", "phone": "+90 555 111 22 33"],
        "preferences": ["units": "metric", "public_profile": false],
    ]

    /// SYNTHETIC server flight for UI tests/screenshots: 40 min from the Teleferik with two thermals.
    nonisolated(unsafe) static let stubFlight: [String: Any] = [
        "id": "00000000-0000-4000-8000-0000000000f1", "status": "ended", "is_simulated": true,
        "started_at": "2026-11-03T10:00:00.000Z", "ended_at": "2026-11-03T10:40:00.000Z",
        "stats": ["duration_s": 2400, "distance_m": 14200, "max_gps_alt_m": 2140, "sample_count": 480, "expected_sample_count": 480, "gap_count": 0],
    ]

    static func stubPositions() -> [[String: Any]] {
        var lat = 37.708, lon = 29.135, alt = 1300.0, heading = 350.0
        let t0 = JSONCoding.parseDate("2026-11-03T10:00:00.000Z") ?? Date()
        var out: [[String: Any]] = []
        let legs: [(Int, Double, Double, Double)] = [(30, 10, -1.2, 0), (60, 8.5, 2.2, 30), (24, 11, -1.1, 0), (60, 8.5, 1.8, -28),
                                                     (60, 11.5, -1.6, 2), (36, 9, -2.0, 25), (90, 10, -1.5, 0), (180, 0, 0, 0)]
        var t = 0.0
        for (n, speed, vario, turn) in legs {
            for _ in 0..<n {
                heading = (heading + turn).truncatingRemainder(dividingBy: 360)
                lat += speed * 5 * cos(heading * .pi / 180) / 111_320
                lon += speed * 5 * sin(heading * .pi / 180) / (111_320 * cos(lat * .pi / 180))
                alt = max(420, alt + vario * 5)
                t += 5
                out.append(["t": JSONCoding.formatDate(t0.addingTimeInterval(t)), "lat": lat, "lon": lon, "gps_alt_m": alt,
                            "speed_ms": speed, "course_deg": speed > 0 ? heading : -1])
            }
        }
        return out
    }

    static var auth: [String: Any] {
        ["access_token": "stub-access", "access_expires_at": "2099-01-01T00:00:00.000Z", "refresh_token": "stub-refresh",
         "refresh_expires_at": "2099-01-01T00:00:00.000Z", "user": me]
    }

    nonisolated(unsafe) static let event: [String: Any] = [
        "id": eventId, "slug": "cameli-paragliding-demo", "name": "Denizli Teleferik Paragliding Demo", "description": "UI test etkinliği",
        "kind": "paragliding", "status": "active", "is_demo": true, "visibility": "public", "location_name": "Denizli Teleferik, Bağbaşı",
        "center": ["lat": 37.708, "lon": 29.135], "center_is_approximate": true,
        "starts_at": "2026-11-01T06:00:00.000Z", "ends_at": "2099-11-30T18:00:00.000Z",
        "settings": ["applications_open": true, "live_tracking": true, "public_live_map": false, "pilots_see_each_other": true, "landing_prompt": true],
        "organizers": [["user_id": "00000000-0000-4000-8000-000000000002", "full_name": "Organizatör"]],
        "counts": ["pilots": 3, "observers": 1, "retrievers": 1],
        "me": ["is_organizer": false, "role": "pilot", "application": NSNull()],
    ]

    static func retrievalJSON(_ id: String, status: String, pickup: Any, note: Any) -> [String: Any] {
        var r: [String: Any] = [
            "id": id, "event_id": eventId, "flight_id": NSNull(), "status": status,
            "pilot": ["user_id": me["id"]!, "full_name": "Stub Pilot", "public_id": "stub"],
            "pickup": pickup, "pilot_position": NSNull(), "note": note, "retriever": NSNull(), "retriever_position": NSNull(),
            "requested_at": now(), "is_simulated": true, "updates": [],
        ]
        if status != "requested" && status != "cancelled" {
            r["retriever"] = ["user_id": "00000000-0000-4000-8000-000000000005", "full_name": "Kübra", "phone": "+90 555 000 00 00"]
            r["retriever_position"] = ["lat": 37.72, "lon": 29.14, "h_acc_m": 8, "t": now()]
            r["accepted_at"] = now()
        }
        return r
    }

    static func route(method: String, path rawPath: String, json: [String: Any]) -> (Int, Any?) {
        let path = rawPath.replacingOccurrences(of: "/api/v1/", with: "")
        let parts = path.split(separator: "/").map(String.init)
        switch (method, parts.first ?? "") {
        case ("POST", "auth"):
            if parts.last == "logout" { return (204, nil) }
            return (200, auth)
        case ("GET", "me"): return (200, me)
        case (_, "me"): return (204, nil)
        case ("GET", "notifications"): return (200, ["items": []])
        case ("POST", "telemetry"):
            let seqs = (json["samples"] as? [[String: Any]] ?? []).compactMap { $0["seq"] as? Int }
            return (200, ["batch_id": json["batch_id"] ?? "", "accepted": seqs, "duplicate": [], "rejected": [],
                          "max_acked_seq": seqs.max() ?? 0, "server_time": now()])
        case ("POST", "flights"):
            if parts.count == 3 { return (200, ["id": parts[1], "status": "ended"]) }
            return (201, ["id": json["id"] ?? "", "status": "recording", "event_id": json["event_id"] ?? NSNull()])
        case ("GET", "flights"):
            if parts.count == 3 && parts[2] == "positions" { return (200, ["items": stubPositions()]) }
            return (200, ["items": [stubFlight], "next_cursor": NSNull()])
        case ("GET", "events"):
            if parts.count == 1 { return (200, ["items": [event], "next_cursor": NSNull()]) }
            if parts.count == 2 { return (200, event) }
            switch parts[2] {
            case "launch-sites":
                return (200, ["items": [
                    ["id": "s1", "event_id": eventId, "name": "Teleferik kalkış", "position": ["lat": 37.708, "lon": 29.135], "elevation_m": 1300, "notes": "", "is_verified": true],
                    ["id": "s2", "event_id": eventId, "name": "Batı yamaç", "position": ["lat": 37.70, "lon": 29.12], "elevation_m": NSNull(), "notes": "", "is_verified": false],
                ]])
            case "live":
                return (200, ["event_id": eventId, "server_time": now(), "cursor": "0-0", "pilots": [], "retrievals": currentRetrievals(), "retrievers": []])
            case "retrievals": return (200, ["items": currentRetrievals()])
            default: return (404, ["error": ["code": "not_found", "message": "stub"]])
            }
        case ("POST", "events") where parts.count == 3 && parts[2] == "retrievals":
            let id = (json["id"] as? String ?? UUID().uuidString).lowercased()
            let r = retrievalJSON(id, status: "requested", pickup: json["pickup"] ?? NSNull(), note: json["note"] ?? "")
            state.withLock { s in if s.retrievals[id] == nil { s.retrievals[id] = (r, Date(), false) } }
            return (201, r)
        case ("POST", "events"): return (204, nil)
        case ("PUT", "events"): return (204, nil)
        case (_, "retrievals") where parts.count >= 2:
            let id = parts[1].lowercased()
            if method == "POST", parts.count == 3, parts[2] == "cancel" {
                state.withLock { s in s.retrievals[id]?.cancelled = true }
            }
            if method == "POST", parts.count == 3, parts[2] == "position" { return (204, nil) }
            guard let r = current(id) else { return (404, ["error": ["code": "not_found", "message": "stub"]]) }
            return (200, r)
        default:
            return (404, ["error": ["code": "not_found", "message": "stub \(method) \(path)"]])
        }
    }

    static func current(_ id: String) -> [String: Any]? {
        state.withLock { s -> [String: Any]? in
            guard let entry = s.retrievals[id] else { return nil }
            let status = entry.cancelled ? "cancelled" : (Date().timeIntervalSince(entry.createdAt) > 4 ? "accepted" : "requested")
            return retrievalJSON(id, status: status, pickup: entry.json["pickup"] ?? NSNull(), note: entry.json["note"] ?? "")
        }
    }

    static func currentRetrievals() -> [[String: Any]] {
        let ids = state.withLock { Array($0.retrievals.keys) }
        return ids.compactMap(current)
    }
}

/// Synthetic location source for UI tests (`-stubLocation`): fixes at 2 Hz
/// moving east at ~10 m/s from Denizli Teleferik. Not used outside DEBUG.
@MainActor
final class SimulatedLocationProvider: LocationProviding {
    var onLocations: (([RawLocation]) -> Void)?
    var onAuthorizationChange: ((LocationAuthorization) -> Void)?
    var onError: ((String) -> Void)?
    let authorization = LocationAuthorization(status: .always, fullAccuracy: true, servicesEnabled: true)
    private(set) var backgroundSessionActive = false
    let serviceSessionActive = false
    private var timer: Task<Void, Never>?
    private var step = 0

    func requestWhenInUseAuthorization() {}
    func requestAlwaysAuthorization() {}
    func apply(profile: TrackingProfile) {}

    func startRecording(profile: TrackingProfile) {
        backgroundSessionActive = true
        guard timer == nil else { return }
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                self?.emit()
            }
        }
    }

    func stopRecording() {
        timer?.cancel()
        timer = nil
        backgroundSessionActive = false
    }

    private func emit() {
        step += 1
        let fix = RawLocation(timestamp: Date(), latitude: 37.708, longitude: 29.135 + Double(step) * 0.00006,
                              altitude: 1400, horizontalAccuracy: 5, verticalAccuracy: 4, speed: 10, course: 90,
                              isSimulatedBySoftware: true)
        onLocations?([fix])
    }
}
#endif
