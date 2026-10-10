import ExpoModulesCore

/// iOS konum olayıyla (significant change) uygulamayı arka planda yeniden başlattığında, JS motoru açılmadan
/// takibi sürdürür. Normal açılışta da açık oturum varsa devam eder (idempotent).
public class RetfastTrackingLaunchSubscriber: ExpoAppDelegateSubscriber {
    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        onMain { TrackingEngine.shared.resumeIfNeeded() }
        return false
    }
}
