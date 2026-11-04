import RetfastCore
import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    @MainActor static var model: AppModel?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // iOS relaunches the app in the background for significant-location-change
        // events after a system termination. Build the model (which restores the
        // persisted flight and restarts Core Location) right here, before any scene.
        let forLocation = launchOptions?[.location] != nil
        MainActor.assumeIsolated {
            if AppDelegate.model == nil { AppDelegate.model = AppModel(launchedForLocation: forLocation) }
        }
        return true
    }
}

@main
struct RetfastApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            if let model = AppDelegate.model {
                RootView()
                    .environment(model)
                    .onChange(of: scenePhase) { _, phase in model.scenePhaseChanged(phase) }
            }
        }
    }
}
