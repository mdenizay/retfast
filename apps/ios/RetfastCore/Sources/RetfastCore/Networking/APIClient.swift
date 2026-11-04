import Foundation
import os

public enum APIError: Error, Sendable, Equatable {
    /// Server returned a contract error body (or a bare status).
    case server(status: Int, code: String, message: String?, details: [String: String]?, retryAfter: Double?)
    /// Transport failure (offline, DNS, timeout, TLS). `offline` is true for
    /// errors that mean "no usable network" rather than "server broken".
    case transport(code: Int, offline: Bool)
    case decoding(String)
    /// No credentials, or refresh failed: the user must sign in again.
    case notAuthenticated

    public var status: Int? { if case let .server(s, _, _, _, _) = self { s } else { nil } }
    public var code: String? { if case let .server(_, c, _, _, _) = self { c } else { nil } }
    public var isOffline: Bool { if case let .transport(_, offline) = self { offline } else { false } }
    public var isPasswordChangeRequired: Bool { code == "password_change_required" }
}

/// Events the app reacts to globally (route to login / forced password change).
public enum AuthEvent: Sendable, Equatable {
    case signedIn(Me)
    case sessionExpired
    case passwordChangeRequired
    case signedOut
}

/// Persistence for the refresh token. Access tokens live only in memory.
public protocol TokenStore: Sendable {
    func loadRefreshToken() -> String?
    func saveRefreshToken(_ token: String?)
}

public final class InMemoryTokenStore: TokenStore {
    private let box: LockedBox<String?>
    public init(_ token: String? = nil) { box = LockedBox(token) }
    public func loadRefreshToken() -> String? { box.withLock { $0 } }
    public func saveRefreshToken(_ token: String?) { box.withLock { $0 = token } }
}

/// URLSession + async/await client for the Retfast v1 API.
///
/// Token refresh is *single-flight*: refresh tokens rotate on every use and
/// re-using a rotated token revokes the whole session family, so concurrent
/// 401s must share one `/auth/refresh` call.
public actor APIClient {
    public nonisolated let baseURL: URL
    private let session: URLSession
    private let tokenStore: any TokenStore
    private let encoder = JSONCoding.makeEncoder()
    private let decoder = JSONCoding.makeDecoder()
    private var accessToken: String?
    private var accessExpiresAt: Date?
    private var refreshTask: Task<AuthResponse, any Error>?
    public nonisolated let authEvents = Broadcaster<AuthEvent>()
    /// Number of /auth/refresh calls actually sent (diagnostics & tests).
    public private(set) var refreshCount = 0
    private let clientName: String
    private let deviceName: String?

    private static let log = Logger(subsystem: "com.mizibu.retfast", category: "api")

    /// - Parameter baseURL: server root, e.g. http://localhost:8080 (the client appends /api/v1).
    public init(baseURL: URL, session: URLSession = .shared, tokenStore: any TokenStore,
                clientName: String = "ios", deviceName: String? = nil) {
        self.baseURL = baseURL.appendingPathComponent("api/v1")
        self.session = session
        self.tokenStore = tokenStore
        self.clientName = clientName
        self.deviceName = deviceName
    }

    public var hasRefreshToken: Bool { tokenStore.loadRefreshToken() != nil }
    public var currentAccessToken: String? { accessToken }

    // MARK: Core request

    public struct Request: Sendable {
        public var method: String
        public var path: String
        public var query: [URLQueryItem] = []
        public var body: Data?
        public var authenticated = true
        public var timeout: TimeInterval = 30

        public init(method: String, path: String, query: [URLQueryItem] = [], body: Data? = nil, authenticated: Bool = true) {
            self.method = method; self.path = path; self.query = query; self.body = body; self.authenticated = authenticated
        }
    }

    public func send<T: Decodable & Sendable>(_ request: Request, as type: T.Type = T.self) async throws -> T {
        let data = try await sendRaw(request)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    public func sendNoContent(_ request: Request) async throws {
        _ = try await sendRaw(request)
    }

    public func sendRaw(_ request: Request) async throws -> Data {
        if request.authenticated {
            if accessToken == nil || (accessExpiresAt.map { $0.timeIntervalSinceNow < 30 } ?? false) {
                if tokenStore.loadRefreshToken() != nil { _ = try await refresh() }
                else if accessToken == nil { throw APIError.notAuthenticated }
            }
        }
        do {
            return try await perform(request)
        } catch let error as APIError where request.authenticated && error.status == 401 && error.code == "token_expired" {
            // Refresh once (shared with concurrent callers) and retry the *same* request.
            _ = try await refresh()
            return try await perform(request)
        }
    }

    private func perform(_ request: Request) async throws -> Data {
        var components = URLComponents(url: baseURL.appendingPathComponent(request.path), resolvingAgainstBaseURL: false)!
        if !request.query.isEmpty { components.queryItems = request.query }
        var urlRequest = URLRequest(url: components.url!, timeoutInterval: request.timeout)
        urlRequest.httpMethod = request.method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = request.body {
            urlRequest.httpBody = body
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if request.authenticated, let token = accessToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch let error as URLError {
            throw APIError.transport(code: error.errorCode, offline: Self.isOffline(error))
        } catch {
            throw APIError.transport(code: -1, offline: false)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport(code: -1, offline: false) }
        if (200..<300).contains(http.statusCode) { return data }

        let body = try? decoder.decode(APIErrorBody.self, from: data)
        let retryAfter = http.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
        let error = APIError.server(status: http.statusCode, code: body?.error.code ?? Self.defaultCode(http.statusCode),
                                    message: body?.error.message, details: body?.error.details, retryAfter: retryAfter)
        let requestId = http.value(forHTTPHeaderField: "X-Request-Id") ?? "-"
        Self.log.notice("\(request.method, privacy: .public) \(request.path, privacy: .public) → \(http.statusCode) \(error.code ?? "", privacy: .public) req=\(requestId, privacy: .public)")
        if error.isPasswordChangeRequired { authEvents.send(.passwordChangeRequired) }
        throw error
    }

    static func isOffline(_ e: URLError) -> Bool {
        switch e.code {
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost,
             .timedOut, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .callIsActive:
            true
        default:
            false
        }
    }

    static func defaultCode(_ status: Int) -> String {
        switch status {
        case 401: "unauthorized"
        case 403: "forbidden"
        case 404: "not_found"
        case 409: "conflict"
        case 429: "rate_limited"
        case 503: "unavailable"
        case 400, 422: "validation_failed"
        default: "internal"
        }
    }

    // MARK: Tokens

    /// Single-flight refresh. Concurrent callers await the same task; the new
    /// tokens are applied inside the task so every waiter sees them.
    @discardableResult
    public func refresh() async throws -> AuthResponse {
        if let refreshTask { return try await refreshTask.value }
        guard let token = tokenStore.loadRefreshToken() else {
            accessToken = nil
            throw APIError.notAuthenticated
        }
        refreshCount += 1
        let body = try encoder.encode(["refresh_token": token])
        let task = Task { () throws -> AuthResponse in
            do {
                let data = try await self.perform(Request(method: "POST", path: "auth/refresh", body: body, authenticated: false))
                let auth = try self.decodeAuth(data)
                self.apply(auth)
                return auth
            } catch let error as APIError {
                if case .server(let status, _, _, _, _) = error, status == 401 || status == 403 {
                    // Refresh token revoked/expired/reused: the session is over.
                    self.clearSession()
                    self.authEvents.send(.sessionExpired)
                    throw APIError.notAuthenticated
                }
                throw error
            }
        }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    private func decodeAuth(_ data: Data) throws -> AuthResponse {
        do { return try decoder.decode(AuthResponse.self, from: data) }
        catch { throw APIError.decoding(String(describing: error)) }
    }

    private func apply(_ auth: AuthResponse) {
        accessToken = auth.accessToken
        accessExpiresAt = auth.accessExpiresAt
        if let rt = auth.refreshToken { tokenStore.saveRefreshToken(rt) }
    }

    private func clearSession() {
        accessToken = nil
        accessExpiresAt = nil
        tokenStore.saveRefreshToken(nil)
    }

    // MARK: Auth endpoints

    public func login(email: String, password: String) async throws -> Me {
        var payload = ["email": email, "password": password, "client": clientName]
        if let deviceName { payload["device_name"] = deviceName }
        let data = try await perform(Request(method: "POST", path: "auth/login", body: try encoder.encode(payload), authenticated: false))
        let auth = try decodeAuth(data)
        apply(auth)
        authEvents.send(auth.user.mustChangePassword ? .passwordChangeRequired : .signedIn(auth.user))
        return auth.user
    }

    public func register(email: String, password: String, fullName: String) async throws -> Me {
        let payload = ["email": email, "password": password, "full_name": fullName]
        let data = try await perform(Request(method: "POST", path: "auth/register", body: try encoder.encode(payload), authenticated: false))
        let auth = try decodeAuth(data)
        apply(auth)
        authEvents.send(.signedIn(auth.user))
        return auth.user
    }

    public func changePassword(current: String, new: String) async throws -> Me {
        let body = try encoder.encode(["current_password": current, "new_password": new])
        let data = try await sendRaw(Request(method: "POST", path: "auth/password/change", body: body))
        let auth = try decodeAuth(data)
        apply(auth)
        authEvents.send(.signedIn(auth.user))
        return auth.user
    }

    public func forgotPassword(email: String) async throws {
        try await sendNoContent(Request(method: "POST", path: "auth/password/forgot", body: try encoder.encode(["email": email]), authenticated: false))
    }

    public func logout() async {
        let token = tokenStore.loadRefreshToken()
        if let token, let body = try? encoder.encode(["refresh_token": token]) {
            _ = try? await perform(Request(method: "POST", path: "auth/logout", body: body, authenticated: accessToken != nil))
        }
        clearSession()
        authEvents.send(.signedOut)
    }

    // MARK: Me

    public func me() async throws -> Me { try await send(Request(method: "GET", path: "me")) }

    public func updateMe(fullName: String?, preferences: Preferences?) async throws -> Me {
        struct Body: Encodable { var fullName: String?; var preferences: Preferences? }
        return try await send(Request(method: "PATCH", path: "me", body: try encoder.encode(Body(fullName: fullName, preferences: preferences))))
    }

    public func updatePilot(_ profile: PilotProfile) async throws -> PilotProfile? {
        var p = profile
        p.publicId = nil
        let data = try await sendRaw(Request(method: "PATCH", path: "me/pilot", body: try encoder.encode(p)))
        return try? decoder.decode(PilotProfile.self, from: data)
    }

    public func requestDeletion(reason: String?) async throws -> DeletionRequestStatus {
        try await send(Request(method: "POST", path: "me/deletion-request", body: try encoder.encode(["reason": reason ?? ""])))
    }

    public func cancelDeletion() async throws {
        try await sendNoContent(Request(method: "DELETE", path: "me/deletion-request"))
    }

    public func exportData() async throws -> Data { try await sendRaw(Request(method: "GET", path: "me/export")) }

    public func registerDevice(deviceId: String, appVersion: String, osVersion: String) async throws {
        let body = try encoder.encode(["device_id": deviceId, "platform": "ios", "app_version": appVersion, "os_version": osVersion])
        try await sendNoContent(Request(method: "POST", path: "me/devices", body: body))
    }

    // MARK: Events

    public func events(status: [String] = [], query: String? = nil, near: LatLon? = nil, radiusKm: Double? = nil, cursor: String? = nil) async throws -> ItemsResponse<Event> {
        var q: [URLQueryItem] = []
        if !status.isEmpty { q.append(URLQueryItem(name: "status", value: status.joined(separator: ","))) }
        if let query, !query.isEmpty { q.append(URLQueryItem(name: "q", value: query)) }
        if let near { q.append(URLQueryItem(name: "near", value: "\(near.lat),\(near.lon)")) }
        if let radiusKm { q.append(URLQueryItem(name: "radius_km", value: String(radiusKm))) }
        if let cursor { q.append(URLQueryItem(name: "cursor", value: cursor)) }
        var r = Request(method: "GET", path: "events", query: q)
        r.authenticated = accessToken != nil || hasRefreshToken
        return try await send(r)
    }

    public func event(_ idOrSlug: String) async throws -> Event {
        var r = Request(method: "GET", path: "events/\(idOrSlug)")
        r.authenticated = accessToken != nil || hasRefreshToken
        return try await send(r)
    }

    public func joinEvent(_ id: String) async throws { try await sendNoContent(Request(method: "POST", path: "events/\(id)/join")) }
    public func leaveEvent(_ id: String) async throws { try await sendNoContent(Request(method: "POST", path: "events/\(id)/leave")) }

    public func launchSites(eventId: String) async throws -> [LaunchSite] {
        var r = Request(method: "GET", path: "events/\(eventId)/launch-sites")
        r.authenticated = accessToken != nil || hasRefreshToken
        let data = try await sendRaw(r)
        if let page = try? decoder.decode(ItemsResponse<LaunchSite>.self, from: data) { return page.items }
        return try decoder.decode([LaunchSite].self, from: data)
    }

    public func participants(eventId: String) async throws -> [Participant] {
        try await send(Request(method: "GET", path: "events/\(eventId)/participants"), as: ItemsResponse<Participant>.self).items
    }

    public func liveSnapshot(eventId: String) async throws -> LiveSnapshot {
        var r = Request(method: "GET", path: "events/\(eventId)/live")
        r.authenticated = accessToken != nil || hasRefreshToken
        return try await send(r)
    }

    // MARK: Flights

    public func createFlight(_ body: CreateFlightRequest) async throws -> Flight {
        try await send(Request(method: "POST", path: "flights", body: try encoder.encode(body)))
    }

    public func endFlight(id: String, endedAt: Date) async throws -> Flight? {
        let data = try await sendRaw(Request(method: "POST", path: "flights/\(id)/end", body: try encoder.encode(EndFlightRequest(endedAt: endedAt))))
        return try? decoder.decode(Flight.self, from: data)
    }

    public func flights(eventId: String? = nil, cursor: String? = nil) async throws -> ItemsResponse<Flight> {
        var q: [URLQueryItem] = []
        if let eventId { q.append(URLQueryItem(name: "event_id", value: eventId)) }
        if let cursor { q.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await send(Request(method: "GET", path: "flights", query: q))
    }

    public func flight(_ id: String) async throws -> Flight { try await send(Request(method: "GET", path: "flights/\(id)")) }

    public func positions(flightId: String, afterSeq: Int? = nil, limit: Int = 5000, simplify: Bool = false) async throws -> ItemsResponse<Position> {
        var q = [URLQueryItem(name: "limit", value: String(limit))]
        if let afterSeq { q.append(URLQueryItem(name: "after_seq", value: String(afterSeq))) }
        if simplify { q.append(URLQueryItem(name: "simplify", value: "true")) }
        return try await send(Request(method: "GET", path: "flights/\(flightId)/positions", query: q))
    }

    public func uploadBatch(_ batch: TelemetryBatchRequest) async throws -> TelemetryBatchResponse {
        var r = Request(method: "POST", path: "telemetry/batches", body: try encoder.encode(batch))
        r.timeout = 45
        return try await send(r)
    }

    // MARK: Incidents & rescue

    public func createIncident(_ body: CreateIncidentRequest) async throws -> Incident {
        try await send(Request(method: "POST", path: "incidents", body: try encoder.encode(body)))
    }

    public func incident(_ id: String) async throws -> Incident { try await send(Request(method: "GET", path: "incidents/\(id)")) }

    public func incidents(status: [String] = [], eventId: String? = nil) async throws -> [Incident] {
        var q: [URLQueryItem] = []
        if !status.isEmpty { q.append(URLQueryItem(name: "status", value: status.joined(separator: ","))) }
        if let eventId { q.append(URLQueryItem(name: "event_id", value: eventId)) }
        return try await send(Request(method: "GET", path: "incidents", query: q), as: ItemsResponse<Incident>.self).items
    }

    public func cancelIncident(_ id: String, reason: String?) async throws {
        _ = try await sendRaw(Request(method: "POST", path: "incidents/\(id)/cancel", body: try encoder.encode(["reason": reason ?? ""])))
    }

    public func acknowledgeIncident(_ id: String) async throws {
        _ = try await sendRaw(Request(method: "POST", path: "incidents/\(id)/acknowledge"))
    }

    public func setIncidentStatus(_ id: String, status: String, note: String?) async throws {
        var payload = ["status": status]
        if let note, !note.isEmpty { payload["note"] = note }
        _ = try await sendRaw(Request(method: "POST", path: "incidents/\(id)/status", body: try encoder.encode(payload)))
    }

    public func addIncidentNote(_ id: String, body: String) async throws {
        _ = try await sendRaw(Request(method: "POST", path: "incidents/\(id)/notes", body: try encoder.encode(["body": body])))
    }

    public func assignIncident(_ id: String, responderUserId: String) async throws {
        _ = try await sendRaw(Request(method: "POST", path: "incidents/\(id)/assignments", body: try encoder.encode(["responder_user_id": responderUserId])))
    }

    public func myAssignments() async throws -> [Assignment] {
        try await send(Request(method: "GET", path: "rescue/assignments"), as: ItemsResponse<Assignment>.self).items
    }

    public func setAssignmentStatus(_ id: String, status: String) async throws {
        _ = try await sendRaw(Request(method: "POST", path: "rescue/assignments/\(id)/status", body: try encoder.encode(["status": status])))
    }

    public func setAvailability(_ availability: String) async throws {
        _ = try await sendRaw(Request(method: "PUT", path: "rescue/me/status", body: try encoder.encode(["availability": availability])))
    }

    public func postRescuePosition(_ p: IncidentPosition) async throws {
        struct Body: Encodable { var lat: Double; var lon: Double; var hAccM: Double?; var t: Date }
        _ = try await sendRaw(Request(method: "POST", path: "rescue/me/position", body: try encoder.encode(Body(lat: p.lat, lon: p.lon, hAccM: p.hAccM, t: p.t ?? Date()))))
    }

    public func rescueTeam() async throws -> [TeamMember] {
        try await send(Request(method: "GET", path: "rescue/team"), as: ItemsResponse<TeamMember>.self).items
    }

    // MARK: Notifications

    public func notifications() async throws -> [AppNotification] {
        try await send(Request(method: "GET", path: "notifications"), as: ItemsResponse<AppNotification>.self).items
    }

    public func markNotificationRead(_ id: String) async throws {
        _ = try await sendRaw(Request(method: "POST", path: "notifications/\(id)/read"))
    }

    // MARK: Session bootstrap

    public enum SessionRestore: Sendable, Equatable {
        case signedIn(Me)
        case passwordChangeRequired(Me)
        /// No stored credentials.
        case signedOut
        /// Stored credentials were refused: sign in again.
        case expired
        /// Credentials kept but the server is unreachable; run offline.
        case offline
    }

    /// On launch: restore from the Keychain refresh token, if any.
    public func restoreSession() async -> SessionRestore {
        guard hasRefreshToken else { return .signedOut }
        do {
            let auth = try await refresh()
            return auth.user.mustChangePassword ? .passwordChangeRequired(auth.user) : .signedIn(auth.user)
        } catch let e as APIError where e == .notAuthenticated {
            return .expired
        } catch {
            return .offline
        }
    }
}
