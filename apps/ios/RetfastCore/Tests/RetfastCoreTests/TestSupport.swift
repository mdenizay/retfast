import Foundation
@testable import RetfastCore

/// Deterministic clock: `sleep` records the requested delay and advances time instantly.
final class TestClock: SyncClock, @unchecked Sendable {
    private let box: LockedBox<(now: Date, sleeps: [Double])>
    init(start: Date = Date(timeIntervalSince1970: 1_800_000_000)) { box = LockedBox((start, [])) }
    func now() -> Date { box.withLock { $0.now } }
    var sleeps: [Double] { box.withLock { $0.sleeps } }
    func advance(_ s: Double) { box.withLock { $0.now = $0.now.addingTimeInterval(s) } }
    func sleep(seconds: Double) async throws {
        box.withLock { $0.sleeps.append(seconds); $0.now = $0.now.addingTimeInterval(seconds) }
        await Task.yield()
    }
}

struct RecordedRequest: Sendable {
    var method: String
    var path: String
    var query: String?
    var authorization: String?
    var body: Data?
    var json: [String: Any]? { body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
}

struct StubResponse: Sendable {
    var status: Int
    var headers: [String: String] = [:]
    var body: Data = Data()
    var delay: Double = 0

    static func json(_ status: Int, _ object: Any, headers: [String: String] = [:]) -> StubResponse {
        StubResponse(status: status, headers: headers.merging(["Content-Type": "application/json"]) { a, _ in a },
                     body: try! JSONSerialization.data(withJSONObject: object))
    }
    static func error(_ status: Int, _ code: String, headers: [String: String] = [:]) -> StubResponse {
        json(status, ["error": ["code": code, "message": code]], headers: headers)
    }
}

enum StubFailure: Error { case offline }

/// In-process fake server reached through a URLProtocol. Each server has its
/// own id, carried as a header, so parallel tests never share handlers.
final class StubServer: @unchecked Sendable {
    typealias Handler = @Sendable (RecordedRequest) throws -> StubResponse
    let id = UUID().uuidString
    private let routes = LockedBox<[String: Handler]>([:])
    private let log = LockedBox<[RecordedRequest]>([])

    func on(_ method: String, _ path: String, _ handler: @escaping Handler) {
        routes.withLock { $0["\(method) \(path)"] = handler }
    }

    var requests: [RecordedRequest] { log.withLock { $0 } }
    func requests(_ method: String, _ path: String) -> [RecordedRequest] {
        requests.filter { $0.method == method && $0.path == path }
    }

    func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        config.httpAdditionalHeaders = ["X-Stub-ID": id]
        StubURLProtocol.servers.withLock { $0[id] = self }
        return URLSession(configuration: config)
    }

    func handle(_ request: RecordedRequest) throws -> StubResponse {
        log.withLock { $0.append(request) }
        let key = "\(request.method) \(request.path)"
        guard let handler = routes.withLock({ $0[key] }) else { return .error(404, "not_found") }
        return try handler(request)
    }
}

final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    static let servers = LockedBox<[String: StubServer]>([:])

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let id = request.value(forHTTPHeaderField: "X-Stub-ID") ?? ""
        guard let server = Self.servers.withLock({ $0[id] }), let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        let recorded = RecordedRequest(method: request.httpMethod ?? "GET", path: url.path, query: url.query,
                                       authorization: request.value(forHTTPHeaderField: "Authorization"),
                                       body: request.httpBody ?? Self.readStream(request.httpBodyStream))
        do {
            let response = try server.handle(recorded)
            let deliver = { [self] in
                let http = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1", headerFields: response.headers)!
                client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: response.body)
                client?.urlProtocolDidFinishLoading(self)
            }
            if response.delay > 0 {
                DispatchQueue.global().asyncAfter(deadline: .now() + response.delay, execute: deliver)
            } else {
                deliver()
            }
        } catch {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
        }
    }

    static func readStream(_ stream: InputStream?) -> Data? {
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
}

// MARK: Fixtures

enum Fixtures {
    static let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    static func fix(_ i: Int, lat: Double = 37.07, lon: Double = 29.34, alt: Double = 2100, hAcc: Double = 5,
                    vAcc: Double = 4, speed: Double = 9, course: Double = 200, dt: Double = 1, start: Date = t0) -> RawLocation {
        RawLocation(timestamp: start.addingTimeInterval(Double(i) * dt), latitude: lat + Double(i) * 0.0001, longitude: lon,
                    altitude: alt, horizontalAccuracy: hAcc, verticalAccuracy: vAcc, speed: speed, course: course)
    }

    static func newSample(_ i: Int, hAcc: Double = 5) -> NewSample {
        NewSample(raw: fix(i, hAcc: hAcc), deviceT: t0.addingTimeInterval(Double(i)), profile: .activeFlight,
                  conditions: DeviceConditions(batteryLevel: 0.8, batteryState: .unplugged, lowPowerMode: false),
                  lowQuality: hAcc > 50)
    }

    static func tempURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("retfast-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("retfast.sqlite")
    }

    static func store() throws -> LocalTelemetryStore { try LocalTelemetryStore.open(at: tempURL()) }

    static func flight(serverCreated: Bool = false, state: FlightSessionState = .recording, startedAt: Date = t0) -> LocalFlight {
        var f = LocalFlight(eventId: nil, eventName: nil, visibility: "event", isSimulated: false, startedAt: startedAt, state: state)
        f.serverCreated = serverCreated
        return f
    }

    static func me(mustChange: Bool = false) -> [String: Any] {
        ["id": "u1", "email": "p@example.com", "full_name": "Pilot", "roles": ["pilot"],
         "must_change_password": mustChange, "created_at": "2026-11-04T10:00:00.000Z"]
    }

    static func auth(access: String, refresh: String, mustChange: Bool = false) -> [String: Any] {
        ["access_token": access, "access_expires_at": "2099-01-01T00:00:00.000Z", "refresh_token": refresh,
         "refresh_expires_at": "2099-01-01T00:00:00.000Z", "user": me(mustChange: mustChange)]
    }
}
