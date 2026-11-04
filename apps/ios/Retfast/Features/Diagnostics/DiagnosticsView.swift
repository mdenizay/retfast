import RetfastCore
import SwiftUI
import UIKit

/// Snapshot of everything support needs to understand a tracking problem.
/// Coordinates are shown on screen (the user's own device) but never logged.
@MainActor
struct LocationDiagnostics {
    var authorization: LocationAuthorization
    var trackingState: FlightSessionState
    var profile: TrackingProfile
    var lastFix: Date?
    var lastAccuracy: Double?
    var lastServerAck: Date?
    var pendingCount: Int
    var sync: SyncSnapshot
    var conditions: DeviceConditions
    var backgroundSession: Bool
    var serviceSession: Bool
    var engineEvents: [EngineEvent]
    var engineError: String?
    var dbSize: Int64
    var dbRecoveries: [StoreRecoveryEvent]
    var storeFatal: String?
    var appVersion: String
    var os: String
    var network: NetworkStatus
    var realtime: RealtimeConnectionState
    var interruptions: Int

    static func capture(_ model: AppModel) -> LocationDiagnostics {
        let s = model.session
        return LocationDiagnostics(
            authorization: s.authorization, trackingState: s.state, profile: s.profile,
            lastFix: s.values.lastFixAt, lastAccuracy: s.values.horizontalAccuracy,
            lastServerAck: model.syncSnapshot.lastServerAck, pendingCount: (try? model.store.pendingCount()) ?? -1,
            sync: model.syncSnapshot, conditions: DeviceStatus.current(),
            backgroundSession: s.backgroundSessionActive, serviceSession: s.serviceSessionActive,
            engineEvents: s.engineEvents, engineError: s.lastError,
            dbSize: model.store.databaseSizeBytes(), dbRecoveries: model.store.recoveryHistory(),
            storeFatal: model.storeFatalError,
            appVersion: "\(model.config.appVersion) (\(model.config.build))",
            os: "iOS \(UIDevice.current.systemVersion) · \(UIDevice.current.model)",
            network: model.networkStatus, realtime: model.realtimeState,
            interruptions: s.flight?.interruptionCount ?? 0)
    }

    /// Plain-text report for support (no coordinates).
    var report: String {
        var lines = [
            "Retfast \(appVersion) · \(os)",
            "permission=\(authorization.status.rawValue) precise=\(authorization.fullAccuracy) services=\(authorization.servicesEnabled)",
            "state=\(trackingState.rawValue) profile=\(profile.rawValue) interruptions=\(interruptions)",
            "lastFix=\(lastFix.map(JSONCoding.formatDate) ?? "-") hAcc=\(lastAccuracy.map { String(format: "%.1f", $0) } ?? "-")",
            "sync=\(sync.status) pending=\(pendingCount) lastAck=\(lastServerAck.map(JSONCoding.formatDate) ?? "-") failures=\(sync.consecutiveFailures) lastError=\(sync.lastError ?? "-")",
            "battery=\(conditions.batteryLevel.map { String(format: "%.2f", $0) } ?? "-") state=\(conditions.batteryState.rawValue) lowPower=\(conditions.lowPowerMode)",
            "bgSession=\(backgroundSession) serviceSession=\(serviceSession) network=\(network.isConnected) \(network.interface.rawValue)",
            "db=\(dbSize) recoveries=\(dbRecoveries.count) fatal=\(storeFatal ?? "-") engineError=\(engineError ?? "-")",
        ]
        lines += engineEvents.suffix(30).map { "\(JSONCoding.formatDate($0.at)) \($0.message)" }
        return lines.joined(separator: "\n")
    }
}

struct DiagnosticsView: View {
    @Environment(AppModel.self) private var model
    @State private var d: LocationDiagnostics?

    var body: some View {
        List {
            if let d {
                Section("Konum izni") {
                    KeyValueRow(key: String(localized: "İzin"), value: statusText(d.authorization.status))
                    KeyValueRow(key: String(localized: "Hassas konum"), value: d.authorization.fullAccuracy ? String(localized: "Açık") : String(localized: "Kapalı (yaklaşık)"))
                    KeyValueRow(key: String(localized: "Konum servisleri"), value: d.authorization.servicesEnabled ? String(localized: "Açık") : String(localized: "Kapalı"))
                }
                Section("Takip") {
                    KeyValueRow(key: String(localized: "Durum"), value: d.trackingState.rawValue, mono: true)
                    KeyValueRow(key: String(localized: "Profil"), value: d.profile.rawValue, mono: true)
                    KeyValueRow(key: String(localized: "Son GPS zamanı"), value: d.lastFix.map { "\(Fmt.time($0)) (\(Fmt.relative($0)))" } ?? Fmt.dash)
                    KeyValueRow(key: String(localized: "GPS doğruluğu"), value: Fmt.accuracy(d.lastAccuracy))
                    KeyValueRow(key: String(localized: "Arka plan oturumu"), value: d.backgroundSession ? String(localized: "Aktif") : String(localized: "Yok"))
                    KeyValueRow(key: String(localized: "Servis oturumu (iOS 18+)"), value: d.serviceSession ? String(localized: "Aktif") : String(localized: "Yok"))
                    KeyValueRow(key: String(localized: "Kesinti (bu uçuş)"), value: "\(d.interruptions)")
                    if let e = d.engineError { KeyValueRow(key: String(localized: "Motor hatası"), value: e, mono: true) }
                }
                Section("Senkronizasyon") {
                    SyncBadge(snapshot: d.sync)
                    KeyValueRow(key: String(localized: "Bekleyen nokta"), value: "\(d.pendingCount)")
                    KeyValueRow(key: String(localized: "Son sunucu onayı"), value: d.lastServerAck.map { "\(Fmt.time($0)) (\(Fmt.relative($0)))" } ?? Fmt.dash)
                    KeyValueRow(key: String(localized: "Ardışık hata"), value: "\(d.sync.consecutiveFailures)")
                    if let next = d.sync.nextRetryAt { KeyValueRow(key: String(localized: "Sonraki deneme"), value: Fmt.time(next)) }
                    if let e = d.sync.lastError { KeyValueRow(key: String(localized: "Son hata"), value: e, mono: true) }
                    KeyValueRow(key: String(localized: "Ağ"), value: d.network.isConnected ? d.network.interface.rawValue : String(localized: "yok"))
                    KeyValueRow(key: String(localized: "Canlı bağlantı"), value: String(describing: d.realtime))
                    KeyValueRow(key: String(localized: "Sunucu"), value: model.config.apiBaseURL.absoluteString, mono: true)
                }
                Section("Cihaz") {
                    KeyValueRow(key: String(localized: "Pil"), value: Fmt.battery(d.conditions.batteryLevel) + " · " + d.conditions.batteryState.rawValue)
                    KeyValueRow(key: String(localized: "Düşük Güç Modu"), value: d.conditions.lowPowerMode ? String(localized: "Açık") : String(localized: "Kapalı"))
                    KeyValueRow(key: String(localized: "Veritabanı boyutu"), value: Fmt.bytes(d.dbSize))
                    KeyValueRow(key: String(localized: "Uygulama sürümü"), value: d.appVersion)
                    KeyValueRow(key: String(localized: "Sistem"), value: d.os)
                }
                if !d.dbRecoveries.isEmpty || d.storeFatal != nil {
                    Section("Veritabanı kurtarma") {
                        if let f = d.storeFatal { WarningRow(text: String(localized: "Veritabanı açılamadı: \(f)"), tone: .error) }
                        ForEach(d.dbRecoveries, id: \.quarantinedPath) { r in
                            VStack(alignment: .leading) {
                                Text(Fmt.dateTime(r.occurredAt)).font(.headline)
                                Text(r.reason).font(.caption.monospaced())
                                Text(r.quarantinedPath).font(.caption2.monospaced()).foregroundStyle(AeroTokens.textSecondary)
                            }
                        }
                    }
                }
                Section("Motor olayları") {
                    if d.engineEvents.isEmpty { Text("Olay yok").foregroundStyle(AeroTokens.textSecondary) }
                    ForEach(d.engineEvents.reversed().prefix(50)) { e in
                        VStack(alignment: .leading) {
                            Text(Fmt.time(e.at)).font(.caption.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary)
                            Text(e.message).font(.caption.monospaced())
                        }
                    }
                }
                Section {
                    ShareLink(item: d.report) { Label("Tanılama raporunu paylaş (koordinat içermez)", systemImage: "square.and.arrow.up") }
                }
            }
        }
        .navigationTitle("Tanılama")
        .task {
            while !Task.isCancelled {
                d = LocationDiagnostics.capture(model)
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func statusText(_ s: LocationAuthorization.Status) -> String {
        switch s {
        case .notDetermined: String(localized: "Sorulmadı")
        case .restricted: String(localized: "Kısıtlı")
        case .denied: String(localized: "Reddedildi")
        case .whenInUse: String(localized: "Kullanımdayken")
        case .always: String(localized: "Her zaman")
        }
    }
}
