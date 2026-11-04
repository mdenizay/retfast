import Foundation
import Observation
import RetfastCore
import SwiftUI
import UIKit
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

/// App-lifetime composition root. Created in `AppDelegate.didFinishLaunching`
/// so a background relaunch for location events restores recording before any
/// UI exists.
@MainActor
@Observable
final class AppModel {
    let config: AppConfig
    let store: LocalTelemetryStore
    /// Set if even a fresh database could not be opened (recording NOT persisted).
    let storeFatalError: String?
    let api: APIClient
    let sync: TelemetrySyncEngine
    let emergency: EmergencyManager
    let network = NetworkMonitor()
    let realtime: RealtimeClient
    let location: LocationEngine
    let session: FlightSessionManager
    let launchedForLocation: Bool

    var authPhase: AuthPhase = .loading
    var authMessage: String?
    var me: Me?
    /// Signed in from cached profile while the server is unreachable.
    var isOfflineSession = false
    var syncSnapshot: SyncSnapshot = .initial
    var networkStatus: NetworkStatus = .unknown
    var realtimeState: RealtimeConnectionState = .disconnected
    var incidents: [UUID: LocalIncident] = [:]
    var events: [Event] = []
    var notifications: [AppNotification] = []
    var showFlightComputer = false
    var showSOS = false
    var selectedTab: AppTab = .home
    var onboardingCompleted: Bool {
        didSet { UserDefaults.standard.set(onboardingCompleted, forKey: "onboardingCompleted") }
    }

    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private static let log = Logger(subsystem: "com.mizibu.retfast", category: "app")

    init(launchedForLocation: Bool) {
        self.launchedForLocation = launchedForLocation
        let config = AppConfig.load()
        self.config = config
        let uiTesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")
        if uiTesting {
            // UI tests start from a clean slate: no onboarding flag, no local DB
            // (a flight left active by an earlier run would otherwise be restored).
            UserDefaults.standard.removeObject(forKey: "onboardingCompleted")
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
        let api = APIClient(baseURL: config.apiBaseURL, tokenStore: tokenStore, deviceName: UIDevice.current.name)
        self.api = api
        let device = DeviceInfo(appVersion: "\(config.appVersion) (\(config.build))", osVersion: "iOS \(UIDevice.current.systemVersion)")
        sync = TelemetrySyncEngine(store: store, api: api, device: device)
        emergency = EmergencyManager(store: store, api: api)
        realtime = RealtimeClient(baseURL: config.apiBaseURL, tokenProvider: { await api.currentAccessToken })
        location = LocationEngine()
        session = FlightSessionManager(store: store, location: location)
        me = Self.cachedMe(store)

        // 1. Restore recording first — this is what a background relaunch is for.
        session.restore()
        if session.isActive { Self.log.notice("restored active flight on launch (location relaunch: \(launchedForLocation))") }
        wire()
    }

    static func databaseURL(uiTesting: Bool) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent(uiTesting ? "RetfastUITest" : "Retfast", isDirectory: true)
            .appendingPathComponent("retfast.sqlite")
    }

    private func wire() {
        network.start()
        let sync = self.sync, emergency = self.emergency
        let networkUpdates = network.updates.stream()
        tasks.append(Task { [weak self] in
            for await status in networkUpdates {
                self?.networkStatus = status
                await sync.networkChanged(isConnected: status.isConnected)
                if status.isConnected, self?.isOfflineSession == true { await self?.restoreAuth() }
            }
        })
        tasks.append(Task { [weak self] in
            for await snap in sync.snapshots.stream() { self?.syncSnapshot = snap }
        })
        tasks.append(Task { [weak self] in
            for await incident in emergency.updates.stream() { self?.incidents[incident.id] = incident }
        })
        tasks.append(Task { [weak self] in
            for await active in emergency.activeEmergency.stream() { self?.session.setEmergency(active) }
        })
        tasks.append(Task { [weak self] in
            guard let self else { return }
            for await event in api.authEvents.stream() { self.handle(event) }
        })
        tasks.append(Task { [weak self] in
            guard let self else { return }
            for await state in realtime.connection.stream() { self.realtimeState = state }
        })
        Task {
            await sync.start()
            try? await emergency.resumeAll()
        }
        for incident in (try? store.incidents(limit: 50)) ?? [] { incidents[incident.id] = incident }
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
            await refreshEvents()
            await refreshNotifications()
            try? await api.registerDevice(deviceId: UIDevice.current.identifierForVendor?.uuidString ?? "unknown",
                                          appVersion: "\(config.appVersion) (\(config.build))",
                                          osVersion: UIDevice.current.systemVersion)
        }
    }

    func logout() async {
        await realtime.disconnect()
        await api.logout()
        try? store.setValue(nil, forKey: "me")
        me = nil
        events = []
        notifications = []
        authPhase = .signedOut
    }

    static func cachedMe(_ store: LocalTelemetryStore) -> Me? {
        guard let json = try? store.value(forKey: "me") else { return nil }
        return try? JSONCoding.makeDecoder().decode(Me.self, from: Data(json.utf8))
    }

    // MARK: Data

    func refreshEvents() async {
        guard let page = try? await api.events(status: ["active", "published"]) else { return }
        events = page.items
    }

    func refreshNotifications() async {
        if let items = try? await api.notifications() { notifications = items }
    }

    var activeEvents: [Event] { events.filter { $0.status == "active" } }

    /// The event the pilot is most likely flying in: an active one they belong to.
    var suggestedEvent: Event? {
        activeEvents.first { $0.myRole == "participant" || $0.myRole == "organizer" } ?? activeEvents.first { $0.myRole != nil }
    }

    func event(id: UUID?) -> Event? {
        guard let id else { return nil }
        return events.first { $0.id.lowercased() == id.uuidString.lowercased() }
    }

    var showsRescue: Bool {
        (me?.isRescueCapable ?? false) || events.contains { $0.myRole == "organizer" }
    }

    var activeIncident: LocalIncident? {
        incidents.values.filter { !$0.isTerminal }.sorted { $0.createdAtDevice > $1.createdAtDevice }.first
    }

    // MARK: Flight

    func startFlight(_ options: FlightSessionManager.StartOptions) throws {
        try session.start(options)
        Haptics.start()
        showFlightComputer = true
    }

    func endFlight() {
        do {
            try session.end()
            Haptics.stop()
            Task { await sync.kick() }
        } catch {
            Self.log.error("end failed \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: Lifecycle

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            if session.isActive || session.state == .completed { showFlightComputer = true }
            Task {
                await sync.kick()
                if authPhase == .signedIn { await refreshNotifications() }
            }
        case .background:
            // Realtime is foreground-only; recording + sync continue while iOS lets us run.
            Task { await realtime.disconnect() }
        default:
            break
        }
    }
}

enum AppTab: Hashable { case home, explore, flights, rescue, profile }
