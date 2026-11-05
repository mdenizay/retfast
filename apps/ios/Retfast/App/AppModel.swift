import Foundation
import Observation
import RetfastCore
import SwiftUI
import UIKit
import UserNotifications
import os

enum AuthPhase: Equatable {
    case loading
    case signedOut
    case mustChangePassword
    case signedIn
}

struct AppConfig {
    let apiBaseURL: URL
    let appVersion: String
    let build: String

    static func load(bundle: Bundle = .main) -> AppConfig {
        let raw = bundle.object(forInfoDictionaryKey: "RetfastAPIBaseURL") as? String ?? ""
        #if DEBUG
        // Test/dev override (UI tests, alternative local ports). Not honoured in Release.
        let override = ProcessInfo.processInfo.environment["RETFAST_API_BASE_URL"]
        #else
        let override: String? = nil
        #endif
        let url = URL(string: override ?? raw).flatMap { $0.scheme == nil ? nil : $0 } ?? URL(string: "https://api.retfast.com")!
        return AppConfig(apiBaseURL: url,
                         appVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?",
                         build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?")
    }
}

/// Full-screen activity presented over the tabs.
enum Overlay: Identifiable, Equatable {
    case flight
    case retrieval(UUID)
    var id: String {
        switch self {
        case .flight: "flight"
        case .retrieval(let id): "retrieval-\(id.uuidString)"
        }
    }
}

/// Context for the "Retrieve iste" sheet.
struct RetrieveContext: Identifiable, Equatable {
    let id = UUID()
    let eventId: String
    let eventName: String?
    let flightId: UUID?
}

enum AppTab: Hashable { case events, flights, profile }

enum EventRoute: Hashable {
    case event(String)
    case applications(String)
    case members(String)
}

/// App-lifetime composition root. Created in `AppDelegate.didFinishLaunching`
/// so a background relaunch for location events restores recording, a waiting
/// retrieve and retriever duty before any UI exists.
@MainActor
@Observable
final class AppModel {
    let config: AppConfig
    let store: LocalTelemetryStore
    /// Set if even a fresh database could not be opened (recording NOT persisted).
    let storeFatalError: String?
    let api: APIClient
    let sync: TelemetrySyncEngine
    let retrievals: RetrievalManager
    let network = NetworkMonitor()
    let realtime: RealtimeClient
    /// The single location source (Core Location, or a simulated one in UI tests).
    let location: any LocationProviding
    let arbiter: LocationArbiter
    let session: FlightSessionManager
    let sharing: PositionSharingManager
    let launchedForLocation: Bool
    let isStubbed: Bool

    var authPhase: AuthPhase = .loading
    var authMessage: String?
    var me: Me?
    /// Signed in from cached profile while the server is unreachable.
    var isOfflineSession = false
    var syncSnapshot: SyncSnapshot = .initial
    var networkStatus: NetworkStatus = .unknown
    var realtimeState: RealtimeConnectionState = .disconnected
    var events: [Event] = []
    var eventsError: String?
    var eventsLoading = false
    var notifications: [AppNotification] = []
    var localRetrievals: [UUID: LocalRetrieval] = [:]
    var retrieverDuty: RetrieverDutyState?
    var retrieverBoard: RetrieverBoard?

    var overlay: Overlay?
    var retrieveRequest: RetrieveContext?
    var showLandingPrompt = false
    var selectedTab: AppTab = .events
    var eventsPath: [EventRoute] = []
    var onboardingCompleted: Bool {
        didSet { UserDefaults.standard.set(onboardingCompleted, forKey: "onboardingCompleted") }
    }

    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var landing = LandingPromptDetector(enabled: false)
    @ObservationIgnored private var restoredOverlayShown = false
    @ObservationIgnored private static let log = Logger(subsystem: "com.mizibu.retfast", category: "app")

    init(launchedForLocation: Bool) {
        self.launchedForLocation = launchedForLocation
        let config = AppConfig.load()
        self.config = config
        let args = ProcessInfo.processInfo.arguments
        let uiTesting = args.contains("-uiTesting")
        #if DEBUG
        let stubbed = args.contains("-stubAPI")
        let simulatedLocation = args.contains("-stubLocation")
        #else
        let stubbed = false
        let simulatedLocation = false
        #endif
        isStubbed = stubbed
        if uiTesting {
            // UI tests start from a clean slate: no onboarding flag, no local DB
            // (a flight left active by an earlier run would otherwise be restored).
            UserDefaults.standard.removeObject(forKey: "onboardingCompleted")
            for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix("sharingAck.") {
                UserDefaults.standard.removeObject(forKey: key)
            }
            try? FileManager.default.removeItem(at: Self.databaseURL(uiTesting: true).deletingLastPathComponent())
        }
        onboardingCompleted = UserDefaults.standard.bool(forKey: "onboardingCompleted")

        var fatal: String?
        let store: LocalTelemetryStore
        do {
            store = try LocalTelemetryStore.open(at: Self.databaseURL(uiTesting: uiTesting))
        } catch {
            fatal = String(describing: error)
            store = try! LocalTelemetryStore.inMemory()
        }
        self.store = store
        self.storeFatalError = fatal

        let tokenStore: any TokenStore = uiTesting ? InMemoryTokenStore() : KeychainTokenStore()
        var urlSession = URLSession.shared
        #if DEBUG
        if stubbed { urlSession = StubBackend.makeSession() }
        #endif
        let api = APIClient(baseURL: config.apiBaseURL, session: urlSession, tokenStore: tokenStore, deviceName: UIDevice.current.name)
        self.api = api
        let device = DeviceInfo(appVersion: "\(config.appVersion) (\(config.build))", osVersion: "iOS \(UIDevice.current.systemVersion)")
        sync = TelemetrySyncEngine(store: store, api: api, device: device)
        retrievals = RetrievalManager(store: store, api: api, pollInterval: stubbed ? 3 : 15)
        realtime = RealtimeClient(baseURL: config.apiBaseURL, enabled: !stubbed, tokenProvider: { await api.currentAccessToken })

        var engine: any LocationProviding = LocationEngine()
        #if DEBUG
        if simulatedLocation { engine = SimulatedLocationProvider() }
        #endif
        location = engine
        let arbiter = LocationArbiter(engine: engine)
        self.arbiter = arbiter
        session = FlightSessionManager(store: store, location: arbiter.client(.flight))
        sharing = PositionSharingManager(location: arbiter.client(.sharing), sender: { mode, position in
            switch mode {
            case .off: return
            case .pilotWaiting(let id, _): try await api.postRetrievalPosition(id, position)
            case .retriever(let eventId): try await api.postRetrieverPosition(eventId: eventId, position)
            }
        })
        me = Self.cachedMe(store)
        retrieverDuty = RetrieverDutyState.load(store)

        // 1. Restore recording first — this is what a background relaunch is for.
        session.restore()
        if session.isActive { Self.log.notice("restored active flight on launch (location relaunch: \(launchedForLocation))") }
        // 2. Restore a waiting retrieve and retriever duty (position sharing).
        for r in (try? store.retrievals(limit: 30)) ?? [] { localRetrievals[r.id] = r }
        refreshSharing()
        wire()
    }

    static func databaseURL(uiTesting: Bool) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent(uiTesting ? "RetfastUITest" : "Retfast", isDirectory: true)
            .appendingPathComponent("retfast.sqlite")
    }

    private func wire() {
        network.start()
        let sync = self.sync, retrievals = self.retrievals
        let networkUpdates = network.updates.stream()
        tasks.append(Task { [weak self] in
            for await status in networkUpdates {
                self?.networkStatus = status
                await sync.networkChanged(isConnected: status.isConnected)
                if status.isConnected, self?.isOfflineSession == true { await self?.restoreAuth() }
                if status.isConnected { await retrievals.kickAll() }
            }
        })
        tasks.append(Task { [weak self] in
            for await snap in sync.snapshots.stream() { self?.syncSnapshot = snap }
        })
        tasks.append(Task { [weak self] in
            for await r in retrievals.updates.stream() {
                guard let self else { return }
                self.localRetrievals[r.id] = r
                self.refreshSharing()
            }
        })
        tasks.append(Task { [weak self] in
            guard let self else { return }
            for await event in api.authEvents.stream() { self.handle(event) }
        })
        tasks.append(Task { [weak self] in
            guard let self else { return }
            for await state in realtime.connection.stream() { self.realtimeState = state }
        })
        sharing.onTargetGone = { [weak self] mode in
            guard let self else { return }
            // The retrieval closed (or duty ended) server-side: re-read the truth.
            if case .pilotWaiting = mode { Task { await self.retrievals.kickAll() } }
            if case .retriever = mode { Task { await self.retrieverBoard?.refresh() } }
        }
        Task {
            await sync.start()
            try? await retrievals.resumeAll()
        }
        observeFlightForLandingPrompt()
        Task { await restoreAuth() }
        _ = try? store.prune(keepRecentFlights: 30)
    }

    // MARK: Auth

    func restoreAuth() async {
        switch await api.restoreSession() {
        case .signedIn(let me):
            didSignIn(me)
        case .passwordChangeRequired(let me):
            self.me = me
            isOfflineSession = false
            authPhase = .mustChangePassword
        case .signedOut:
            authPhase = .signedOut
        case .expired:
            authPhase = .signedOut
            authMessage = String(localized: "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.")
        case .offline:
            if me != nil {
                isOfflineSession = true
                authPhase = .signedIn
            } else {
                authPhase = .signedOut
                authMessage = String(localized: "Sunucuya ulaşılamıyor. İnternet bağlantısını kontrol edin.")
            }
        }
    }

    private func handle(_ event: AuthEvent) {
        switch event {
        case .signedIn(let me): didSignIn(me)
        case .passwordChangeRequired: authPhase = .mustChangePassword
        case .sessionExpired:
            authPhase = .signedOut
            authMessage = String(localized: "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın. Kaydedilen uçuş verileri cihazda korunur.")
        case .signedOut:
            authPhase = .signedOut
        }
    }

    func didSignIn(_ me: Me) {
        self.me = me
        isOfflineSession = false
        authMessage = nil
        if let data = try? JSONCoding.makeEncoder().encode(me) {
            try? store.setValue(String(decoding: data, as: UTF8.self), forKey: "me")
        }
        guard !me.mustChangePassword else { authPhase = .mustChangePassword; return }
        authPhase = .signedIn
        Task {
            await sync.authRestored()
            await retrievals.kickAll()
            await refreshEvents()
            await refreshNotifications()
            restoreRetrieverBoardIfNeeded()
            try? await api.registerDevice(deviceId: UIDevice.current.identifierForVendor?.uuidString ?? "unknown",
                                          appVersion: "\(config.appVersion) (\(config.build))",
                                          osVersion: UIDevice.current.systemVersion)
        }
    }

    func logout() async {
        if let board = retrieverBoard, board.onDuty { try? await board.setDuty(false) }
        retrieverBoard?.stopPolling()
        retrieverBoard = nil
        setRetrieverDuty(nil)
        await realtime.disconnect()
        await api.logout()
        try? store.setValue(nil, forKey: "me")
        me = nil
        events = []
        notifications = []
        eventsPath = []
        authPhase = .signedOut
    }

    static func cachedMe(_ store: LocalTelemetryStore) -> Me? {
        guard let json = try? store.value(forKey: "me") else { return nil }
        return try? JSONCoding.makeDecoder().decode(Me.self, from: Data(json.utf8))
    }

    // MARK: Events

    func refreshEvents() async {
        eventsLoading = true
        defer { eventsLoading = false }
        do {
            events = try await api.events().items
            eventsError = nil
        } catch {
            eventsError = ErrorText.message(error)
        }
    }

    func refreshNotifications() async {
        if let items = try? await api.notifications() { notifications = items }
    }

    func event(id: String?) -> Event? {
        guard let id = id?.lowercased() else { return nil }
        return events.first { $0.id.lowercased() == id }
    }

    func update(event: Event) {
        if let i = events.firstIndex(where: { $0.id == event.id }) { events[i] = event } else { events.append(event) }
    }

    /// Events I belong to (any role or organizer), live ones first.
    var myEvents: [Event] {
        events.filter(\.isMember).sorted { a, b in
            let ra = Self.statusRank(a.status), rb = Self.statusRank(b.status)
            return ra != rb ? ra < rb : (a.startsAt ?? .distantFuture) < (b.startsAt ?? .distantFuture)
        }
    }

    var otherEvents: [Event] {
        events.filter { !$0.isMember && $0.status != "archived" && $0.status != "draft" }
            .sorted { Self.statusRank($0.status) < Self.statusRank($1.status) }
    }

    static func statusRank(_ s: String) -> Int {
        switch s {
        case "active": 0
        case "published": 1
        case "completed": 2
        default: 3
        }
    }

    // MARK: Flight

    func startFlight(in event: Event) throws {
        try session.start(.init(eventId: event.uuid, eventName: event.name, isSimulated: isSimulatedBuild))
        landing = LandingPromptDetector(enabled: event.settings?.landingPrompt ?? true)
        try? store.setValue(event.id, forKey: "flightEventId")
        Haptics.start()
        updateSharingNotice()
    }

    /// The flight is shown in its event's bottom sheet: bring that event to front.
    func openFlightEvent() {
        overlay = nil
        guard let id = session.flight?.eventId?.uuidString.lowercased() else { return }
        selectedTab = .events
        if case .event(let current)? = eventsPath.last, current.lowercased() == id { return }
        eventsPath = [.event(id)]
    }

    /// True while the event screen of the running flight is on screen.
    var isShowingFlightEvent: Bool {
        guard overlay == nil, selectedTab == .events, let id = session.flight?.eventId?.uuidString.lowercased(),
              case .event(let current)? = eventsPath.last else { return false }
        return current.lowercased() == id
    }

    func endFlight() {
        do {
            try session.end()
            Haptics.stop()
            updateSharingNotice()
            Task { await sync.kick() }
        } catch {
            Self.log.error("end failed \(String(describing: error), privacy: .public)")
        }
    }

    /// Ends the recording (if any) and opens the retrieve request for its event.
    func endFlightAndRequestRetrieve() {
        let flight = session.flight
        if session.isActive { endFlight() }
        guard let flight, let eventId = flight.eventId?.uuidString.lowercased() else {
            if session.state == .completed { overlay = .flight }
            return
        }
        retrieveRequest = RetrieveContext(eventId: eventId, eventName: flight.eventName, flightId: flight.id)
    }

    /// The retrieve request was closed without sending ("no retrieve" or swipe):
    /// the finished flight is already saved, so just clear it.
    func dismissRetrieveRequest() {
        retrieveRequest = nil
        if session.state == .completed { session.reset() }
        if overlay == .flight { overlay = nil }
    }

    var isSimulatedBuild: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        isStubbed
        #endif
    }

    /// The flight's event, when the current flight belongs to one.
    var flightEvent: Event? { event(id: session.flight?.eventId?.uuidString) }

    private func observeFlightForLandingPrompt() {
        withObservationTracking {
            _ = session.profile
            _ = session.state
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.checkLanding()
                self?.observeFlightForLandingPrompt()
            }
        }
    }

    private func checkLanding() {
        if session.isActive, let event = flightEvent { landing.enabled = event.settings?.landingPrompt ?? true }
        else if session.isActive && session.flight?.eventId != nil { landing.enabled = true }
        guard landing.observe(profile: session.profile, state: session.state, now: Date()) else { return }
        Haptics.attention()
        showLandingPrompt = true
        if UIApplication.shared.applicationState != .active { Self.postLandingNotification() }
    }

    func snoozeLandingPrompt() {
        landing.snooze(now: Date())
        showLandingPrompt = false
    }

    private static func postLandingNotification() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            let content = UNMutableNotificationContent()
            content.title = String(localized: "İndin mi?")
            content.body = String(localized: "Uygulamayı açıp uçuşu bitirebilir ve retrieve isteyebilirsin.")
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "landing", content: content, trigger: nil))
        }
    }

    // MARK: Retrieval (pilot)

    /// Newest unfinished request (drives the waiting screen and the banner).
    var activeRetrieval: LocalRetrieval? {
        localRetrievals.values.filter { !$0.isTerminal }.max { $0.createdAt < $1.createdAt }
    }

    func activeRetrieval(eventId: String) -> LocalRetrieval? {
        localRetrievals.values.filter { !$0.isTerminal && $0.eventId == eventId.lowercased() }.max { $0.createdAt < $1.createdAt }
    }

    @discardableResult
    func requestRetrieve(_ context: RetrieveContext, pickup: SharedPosition, note: String) async throws -> LocalRetrieval {
        let r = try await retrievals.request(eventId: context.eventId, eventName: context.eventName,
                                             flightId: context.flightId, pickup: pickup, note: note)
        localRetrievals[r.id] = r
        Haptics.start()
        retrieveRequest = nil
        if session.state == .completed { session.reset() }
        overlay = .retrieval(r.id)
        return r
    }

    func cancelRetrieval(_ id: UUID, reason: String) async {
        try? await retrievals.cancel(id: id, reason: reason)
        Haptics.stop()
    }

    // MARK: Retriever

    /// The board for a retriever event; reused so duty survives leaving the screen.
    func board(for event: Event) -> RetrieverBoard? {
        guard let me else { return nil }
        if let b = retrieverBoard, b.eventId == event.id.lowercased() { return b }
        retrieverBoard?.stopPolling()
        let restoredDuty = retrieverDuty?.eventId == event.id.lowercased() ? (retrieverDuty?.onDuty ?? false) : false
        let board = RetrieverBoard(eventId: event.id, eventName: event.name, myUserId: me.id, api: api, onDuty: restoredDuty)
        board.onDutyStateChange = { [weak self] state in self?.setRetrieverDuty(state) }
        board.startPolling()
        retrieverBoard = board
        return board
    }

    private func restoreRetrieverBoardIfNeeded() {
        guard let duty = retrieverDuty, duty.needsSharing, retrieverBoard == nil else { return }
        if let event = event(id: duty.eventId), event.memberRole == .retriever {
            _ = board(for: event)
        } else if !events.isEmpty {
            // No longer a retriever of that event: stop sharing.
            setRetrieverDuty(nil)
        }
    }

    func setRetrieverDuty(_ state: RetrieverDutyState?) {
        let normalized = (state?.needsSharing ?? false) ? state : nil
        guard normalized != retrieverDuty else { return }
        retrieverDuty = normalized
        RetrieverDutyState.save(normalized, to: store)
        refreshSharing()
    }

    // MARK: Sharing

    func refreshSharing() {
        sharing.update(mode: SharingMode.decide(activeRetrieval: activeRetrieval, duty: retrieverDuty))
        updateSharingNotice()
    }

    /// What the "your location is shared" notification currently says (nil = none).
    private var sharingNoticeKey: String?

    /// Keeps one quiet notification in Notification Center / on the lock
    /// screen while Retfast shares the position with an event (live flight,
    /// waiting for a retrieve, retriever duty), and removes it when sharing stops.
    func updateSharingNotice() {
        let body: String?
        let eventName: String?
        if session.isActive {
            eventName = session.flight?.eventName
            body = String(localized: "Uçuşun canlı takip ediliyor.")
        } else {
            switch sharing.mode {
            case .off: eventName = nil; body = nil
            case .pilotWaiting:
                eventName = activeRetrieval?.eventName
                body = String(localized: "Retriever seni bulabilsin diye konumun paylaşılıyor.")
            case .retriever(let id):
                eventName = events.first { $0.id.lowercased() == id.lowercased() }?.name
                body = String(localized: "Retrieve görevindesin; konumun paylaşılıyor.")
            }
        }
        let key = body.map { "\($0)|\(eventName ?? "")" }
        guard key != sharingNoticeKey else { return }
        sharingNoticeKey = key
        let center = UNUserNotificationCenter.current()
        guard let body else {
            center.removeDeliveredNotifications(withIdentifiers: ["sharing"])
            return
        }
        let title = eventName.map { String(localized: "Konumun paylaşılıyor · \($0)") } ?? String(localized: "Konumun paylaşılıyor")
        center.getNotificationSettings { settings in
            let post = {
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                content.interruptionLevel = .passive
                content.threadIdentifier = "sharing"
                center.add(UNNotificationRequest(identifier: "sharing", content: content, trigger: nil))
            }
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: post()
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound]) { ok, _ in if ok { post() } }
            default: break
            }
        }
    }

    /// Best recent own position: flight computer, else sharing.
    func recentFix(maxAge: TimeInterval = 120) -> SharedPosition? {
        let now = Date()
        let v = session.values
        if let t = v.lastFixAt, now.timeIntervalSince(t) < maxAge, let lat = v.latitude, let lon = v.longitude {
            return SharedPosition(lat: lat, lon: lon, gpsAltM: v.gpsAltitude, hAccM: v.horizontalAccuracy, t: t)
        }
        if let f = sharing.lastFix, now.timeIntervalSince(f.timestamp) < maxAge {
            return SharedPosition(lat: f.latitude, lon: f.longitude, gpsAltM: f.verticalAccuracy > 0 ? f.altitude : nil,
                                  hAccM: f.horizontalAccuracy, t: f.timestamp)
        }
        return nil
    }

    // MARK: Lifecycle

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            if session.isActive {
                if overlay == nil { openFlightEvent() }
            } else if session.state == .completed, retrieveRequest == nil {
                if overlay == nil { overlay = .flight }
            } else if !restoredOverlayShown, overlay == nil, let r = activeRetrieval {
                // Relaunch with an open retrieve: show the waiting screen again.
                overlay = .retrieval(r.id)
            }
            restoredOverlayShown = true
            Task {
                await sync.kick()
                await retrievals.kickAll()
                if authPhase == .signedIn {
                    await refreshNotifications()
                    await retrieverBoard?.refresh()
                }
            }
        case .background:
            // Realtime is foreground-only; recording, sharing and polling continue while iOS lets us run.
            Task { await realtime.disconnect() }
        default:
            break
        }
    }
}
