import RetfastCore
import SwiftUI
import UIKit

/// Pre-flight check. Every item is actionable; offline recording is allowed.
struct PreFlightCheckView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var selectedEventId: String?
    @State private var visibility = "event"
    @State private var locator = OneShotLocator()
    @State private var conditions = DeviceConditions.unknown
    @State private var startError: String?
    @State private var pendingFromEarlier = 0

    private var auth: LocationAuthorization { model.session.authorization }
    private var selectedEvent: Event? { model.events.first { $0.id == selectedEventId } }
    private var joinableEvents: [Event] {
        model.events.filter { $0.myRole != nil && ($0.status == "active" || $0.status == "published") }
    }
    private var isSimulatorBuild: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    var body: some View {
        Form {
            Section("Etkinlik") {
                Picker("Etkinlik", selection: $selectedEventId) {
                    Text("Etkinlik yok (kişisel uçuş)").tag(String?.none)
                    ForEach(joinableEvents) { e in Text(e.name).tag(Optional(e.id)) }
                }
                .accessibilityIdentifier("preflight.event")
                if let e = selectedEvent, e.settings?.liveTracking == false {
                    WarningRow(text: String(localized: "Bu etkinlikte canlı takip kapalı. Uçuş kişisel olarak kaydedilir."))
                }
                Picker("Görünürlük", selection: $visibility) {
                    Text("Yalnızca ben").tag("private")
                    Text("Etkinlik katılımcıları").tag("event")
                    Text("Herkese açık").tag("public")
                }
                Text(visibilityExplanation).font(.footnote).foregroundStyle(AeroTokens.textSecondary)
            }

            Section("Kontroller") {
                permissionRow
                accuracyRow
                gpsFixRow
                batteryRow
                networkRow
                storageRow
                backgroundRow
                if pendingFromEarlier > 0 {
                    check(.info, String(localized: "Önceki uçuşlardan \(pendingFromEarlier) nokta henüz gönderilmedi. Bağlantı gelince otomatik gönderilir."), "tray.full")
                }
                if isSimulatorBuild {
                    check(.info, String(localized: "Simülatör: konumlar simüle edilir ve uçuş SIM olarak işaretlenir. Bu, gerçek cihaz doğrulaması değildir."), "desktopcomputer")
                }
            }

            if let startError { Section { WarningRow(text: startError, tone: .error) } }

            Section {
                Button {
                    start()
                } label: {
                    Label("Uçuşu Başlat", systemImage: "play.fill")
                }
                .buttonStyle(.aeroPrimaryLarge)
                .disabled(!canStart)
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                .accessibilityIdentifier("preflight.start")
            } footer: {
                Text("Bağlantı yokken de kayıt yapılır; veriler telefonda saklanır ve bağlantı gelince gönderilir.")
            }
        }
        .navigationTitle("Uçuş öncesi kontrol")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } } }
        .onAppear {
            selectedEventId = model.suggestedEvent?.id
            visibility = model.me?.preferences?.defaultFlightVisibility ?? "event"
            conditions = DeviceStatus.current()
            pendingFromEarlier = (try? model.store.pendingCount()) ?? 0
            locator.request()
        }
        .onChange(of: auth) { _, _ in locator.request() }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryLevelDidChangeNotification)) { _ in conditions = DeviceStatus.current() }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in conditions = DeviceStatus.current() }
    }

    private var canStart: Bool {
        auth.servicesEnabled && auth.status != .denied && auth.status != .restricted && !model.session.isActive
    }

    private var visibilityExplanation: String {
        switch visibility {
        case "private": String(localized: "Canlı konumunuzu yalnızca siz görürsünüz. Acil durum çağrısı açarsanız yetkili kurtarma ekibi görür.")
        case "public": String(localized: "Etkinliğin herkese açık canlı haritasında adınız ve konumunuz görünür.")
        default: String(localized: "Etkinlik katılımcıları ve organizatörler canlı konumunuzu görür.")
        }
    }

    // MARK: Rows

    @ViewBuilder private var permissionRow: some View {
        switch auth.status {
        case _ where !auth.servicesEnabled:
            check(.error, String(localized: "Konum servisleri kapalı. Ayarlar > Gizlilik > Konum Servisleri'nden açın."), "location.slash", action: settingsAction)
        case .always:
            check(.success, String(localized: "Konum izni: Her Zaman. Ekran kilitliyken kayıt sürer."), "location.fill")
        case .whenInUse:
            check(.warning, String(localized: "Konum izni: Kullanımdayken. Kayıt başlatıldıktan sonra arka planda sürer, ancak \"Her Zaman\" izni iOS kesintilerinden sonra kaydın kendiliğinden devam etmesini sağlar."),
                  "location", action: ("\"Her Zaman\" iste", { model.session.requestAlwaysAuthorization() }))
        case .notDetermined:
            check(.warning, String(localized: "Konum izni henüz verilmedi."), "location.circle",
                  action: ("İzin ver", { model.session.requestWhenInUseAuthorization() }))
        case .denied, .restricted:
            check(.error, String(localized: "Konum izni reddedildi. Uçuş kaydı için Ayarlar'dan izin verin."), "location.slash", action: settingsAction)
        }
    }

    @ViewBuilder private var accuracyRow: some View {
        if auth.canRecord {
            if auth.fullAccuracy {
                check(.success, String(localized: "Hassas konum açık."), "scope")
            } else {
                check(.error, String(localized: "Yaklaşık konum seçili. Uçuş izi ve acil durum konumu kilometrelerce hatalı olabilir."), "scope",
                      action: ("Hassas konum iste", { model.location.requestTemporaryFullAccuracy() }))
            }
        }
    }

    @ViewBuilder private var gpsFixRow: some View {
        if let fix = locator.fix {
            let acc = fix.horizontalAccuracy
            check(acc <= 20 ? .success : (acc <= 50 ? .warning : .error),
                  String(localized: "GPS doğruluğu \(Fmt.accuracy(acc)) · \(Fmt.relative(fix.timestamp))"), "location.north.circle",
                  action: ("Yenile", { locator.request() }))
        } else if auth.canRecord {
            check(.info, locator.failed ? String(localized: "Henüz GPS konumu alınamadı. Açık gökyüzü altında bekleyin.") : String(localized: "GPS konumu alınıyor…"), "location.magnifyingglass",
                  action: ("Yenile", { locator.request() }))
        }
    }

    @ViewBuilder private var batteryRow: some View {
        let level = conditions.batteryLevel
        if conditions.lowPowerMode {
            check(.warning, String(localized: "Düşük Güç Modu açık: iOS konum güncellemelerini seyrekleştirebilir."), "battery.25percent")
        }
        if let level {
            check(level < 0.2 ? .error : (level < 0.4 ? .warning : .success),
                  String(localized: "Pil \(Fmt.battery(level))") + (conditions.batteryState == .charging ? String(localized: " · şarj oluyor") : ""),
                  level < 0.4 ? "battery.25percent" : "battery.100percent")
        } else {
            check(.info, String(localized: "Pil seviyesi okunamıyor (simülatör)."), "battery.0percent")
        }
    }

    @ViewBuilder private var networkRow: some View {
        if model.networkStatus.isConnected {
            check(.success, String(localized: "İnternet bağlantısı var") + (model.networkStatus.isConstrained ? String(localized: " (Düşük Veri Modu)") : ""), "wifi")
        } else {
            check(.warning, String(localized: "Bağlantı yok. Kayıt çevrimdışı yapılır; canlı haritada görünmezsiniz ve acil durum çağrısı bağlantı gelene kadar iletilemez."), "wifi.slash")
        }
    }

    @ViewBuilder private var storageRow: some View {
        let free = Self.freeBytes()
        if let free {
            check(free < 200_000_000 ? .warning : .success, String(localized: "Boş alan \(Fmt.bytes(free))"), "internaldrive")
        }
    }

    @ViewBuilder private var backgroundRow: some View {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        if !modes.contains("location") {
            check(.error, String(localized: "Uygulama arka plan konumu için yapılandırılmamış."), "exclamationmark.octagon")
        } else if auth.status == .always && !conditions.lowPowerMode {
            check(.success, String(localized: "Arka plan kaydı hazır. Uygulamayı kaydırarak kapatmayın."), "checkmark.seal")
        } else {
            check(.warning, String(localized: "Arka plan kaydı sınırlı olabilir. Uygulamayı kaydırarak kapatmayın; kapatırsanız iOS konum vermeyi durdurur."), "exclamationmark.triangle")
        }
    }

    private var settingsAction: (LocalizedStringKey, () -> Void) {
        ("Ayarları aç", { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } })
    }

    private func check(_ tone: Tone, _ text: String, _ icon: String, action: (LocalizedStringKey, () -> Void)? = nil) -> some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
            HStack(alignment: .top, spacing: AeroTokens.Space.s3) {
                Image(systemName: icon).foregroundStyle(tone.color).frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(text).fixedSize(horizontal: false, vertical: true)
                    Text(toneLabel(tone)).font(.caption.weight(.semibold)).foregroundStyle(tone.color)
                }
            }
            if let action {
                Button(action.0, action: action.1).font(.subheadline.weight(.semibold))
                    .padding(.leading, 36)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func toneLabel(_ tone: Tone) -> LocalizedStringKey {
        switch tone {
        case .success: "Hazır"
        case .warning: "Uyarı"
        case .error, .emergency: "Engel"
        default: "Bilgi"
        }
    }

    static func freeBytes() -> Int64? {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        return (try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage
    }

    private func start() {
        do {
            let event = selectedEvent
            let vis = event == nil && visibility == "event" ? "private" : visibility
            try model.startFlight(.init(eventId: event?.uuid, eventName: event?.name, visibility: vis, isSimulated: isSimulatorBuild))
            dismiss()
        } catch {
            startError = (error as? FlightSessionManager.SessionError) == .permissionDenied
                ? String(localized: "Konum izni olmadan uçuş kaydı başlatılamaz.")
                : String(localized: "Uçuş başlatılamadı: \(String(describing: error))")
        }
    }
}
