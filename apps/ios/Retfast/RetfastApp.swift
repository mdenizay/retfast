import SwiftUI

@main
struct RetfastApp: App {
    @StateObject private var auth = AuthModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.loading {
                    ProgressView()
                } else if auth.session == nil {
                    LoginView()
                } else {
                    EventsListView()
                }
            }
            .environmentObject(auth)
            .onChange(of: scenePhase) { _, phase in
                // Backgrounding flushes the queue while we still have runtime.
                if phase == .background { SyncEngine.shared.flushNow() }
            }
            .task {
                // Relaunch recovery: if tracking state says we should be live
                // (e.g. after an SLC relaunch), the engines resume from the
                // persisted open task/duty in TrackingResume.
                await TrackingResume.resumeIfNeeded()
            }
        }
    }
}

/// Persists which task/duty session is being tracked so a relaunch (user or
/// significant-location-change) can resume without user interaction.
enum TrackingResume {
    private static let key = "retfast.tracking.target"

    static func remember(taskId: UUID?, sessionId: UUID?) {
        var dict: [String: String] = [:]
        if let taskId { dict["task"] = taskId.uuidString }
        if let sessionId { dict["session"] = sessionId.uuidString }
        UserDefaults.standard.set(dict, forKey: key)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    @MainActor
    static func resumeIfNeeded() async {
        guard !TrackingEngine.shared.isTracking,
              let dict = UserDefaults.standard.dictionary(forKey: key) as? [String: String]
        else { return }
        if let raw = dict["task"], let id = UUID(uuidString: raw) {
            TrackingEngine.shared.start(target: .task(id: id))
        } else if let raw = dict["session"], let id = UUID(uuidString: raw) {
            TrackingEngine.shared.start(target: .retrieverSession(id: id))
        } else {
            return
        }
        SyncEngine.shared.start()
    }
}
