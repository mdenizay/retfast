import RetfastCore
import SwiftUI
import UIKit
import UserNotifications

/// Pilot bottom sheet: "Uçuşa başla" (readiness is shown full screen first); during a
/// flight the live summary; after landing the retrieve status.
struct PilotSheet: View {
    @Environment(AppModel.self) private var model
    let event: Event
    let live: EventLiveModel?
    @State private var startError: String?
    @State private var confirmEnd = false

    init(event: Event, live: EventLiveModel?) {
        self.event = event
        self.live = live
    }

    private var flightHere: Bool {
        model.session.isActive && model.session.flight?.eventId?.uuidString.lowercased() == event.id.lowercased()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            if flightHere {
                InFlightCard(confirmEnd: $confirmEnd)
            } else if model.session.isActive {
                AeroCard {
                    WarningRow(text: String(localized: "Başka bir etkinlikte (\(model.session.flight?.eventName ?? "—")) uçuş kaydı sürüyor. Önce onu bitir."))
                    Button("Uçuş ekranına git") { model.overlay = .flight }.buttonStyle(.aeroSecondary)
                }
            } else if let r = model.activeRetrieval(eventId: event.id) {
                RetrievalStatusCard(retrieval: r)
            } else {
                startSection
            }
        }
        .confirmationDialog("Uçuşu bitir?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("Uçuşu bitir ve retrieve iste") { model.endFlightAndRequestRetrieve() }
            Button("Uçuşu bitir", role: .destructive) { model.endFlight() }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Kayıt durdurulur. Gönderilmemiş noktalar bağlantı gelince gönderilmeye devam eder.")
        }
    }

    @ViewBuilder private var startSection: some View {
        if event.status != "active" {
            WarningRow(text: event.status == "published"
                       ? String(localized: "Etkinlik henüz başlamadı. Uçuşu yine de kaydedebilirsin; canlı haritada görünmeyebilir.")
                       : String(localized: "Etkinlik aktif değil. Uçuş kaydedilir ancak etkinliğe kabul edilmeyebilir."), systemImage: "calendar")
        }
        if event.settings?.liveTracking == false {
            WarningRow(text: String(localized: "Bu etkinlikte canlı takip kapalı. Kayıt telefonda kalır."))
        }
        if let startError { WarningRow(text: startError, tone: .error) }
        Button {
            start()
        } label: {
            Label("Uçuşa başla", systemImage: "paperplane.fill")
        }
        .buttonStyle(.aeroPrimaryLarge)
        .disabled(!canStart)
        .accessibilityIdentifier("pilot.start")
        Button {
            model.retrieveRequest = RetrieveContext(eventId: event.id.lowercased(), eventName: event.name, flightId: nil)
        } label: {
            Label("Kayıt olmadan retrieve iste", systemImage: "car")
        }
        .buttonStyle(.aeroSecondary)
        .accessibilityIdentifier("pilot.retrieveWithoutFlight")
    }

    private var canStart: Bool {
        let auth = model.session.authorization
        return auth.servicesEnabled && auth.status != .denied && auth.status != .restricted && !model.session.isActive
    }

    private func start() {
        do {
            try model.startFlight(in: event)
            startError = nil
        } catch {
            startError = (error as? FlightSessionManager.SessionError) == .permissionDenied
                ? String(localized: "Konum izni olmadan uçuş kaydı başlatılamaz. Ayarlar'dan izin ver.")
                : String(localized: "Uçuş başlatılamadı: \(String(describing: error))")
        }
    }
}

/// Full-screen pre-flight checklist shown when a pilot opens an event.
/// "Devam" goes on to the map with the "Uçuşa başla" button.
struct PreFlightView: View {
    let event: Event
    let onBack: () -> Void
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                MapCircleButton(systemImage: "arrow.left", label: "Geri", action: onBack)
                    .accessibilityIdentifier("preflight.back")
                Spacer()
            }
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.top, AeroTokens.Space.s2)
            ScrollView {
                VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(event.name.uppercased(with: Locale(identifier: "tr_TR")))
                            .font(.caption.weight(.semibold)).foregroundStyle(AeroTokens.textSecondary)
                        Text("Uçuş öncesi").font(.system(size: 34, weight: .bold))
                        Text("Kalkıştan önce telefonun hazır mı kontrol et.")
                            .font(.title3).foregroundStyle(AeroTokens.textSecondary)
                    }
                    ReadinessList()
                }
                .padding(AeroTokens.Space.s4)
            }
            Button(action: onContinue) {
                Label("Devam", systemImage: "arrow.right")
            }
            .buttonStyle(.aeroPrimaryLarge)
            .accessibilityIdentifier("preflight.next")
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.bottom, AeroTokens.Space.s2)
        }
        .aeroBackground()
    }
}

/// Compact flight summary inside the event sheet while recording.
struct InFlightCard: View {
    @Environment(AppModel.self) private var model
    @Binding var confirmEnd: Bool

    var body: some View {
        let v = model.session.values
        let alt = Fmt.altitude(v.gpsAltitude)
        let speed = Fmt.speed(v.groundSpeed)
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            HStack(alignment: .firstTextBaseline) {
                Label(String(localized: model.session.state.titleValue), systemImage: model.session.state.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(model.session.state.tone.color)
                    .symbolEffect(.pulse, isActive: model.session.state == .recording)
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    Text(Fmt.duration(ctx.date.timeIntervalSince(model.session.flight?.startedAt ?? ctx.date)))
                        .font(.system(.title, design: .rounded).monospacedDigit().weight(.bold))
                }
            }
            HStack(spacing: AeroTokens.Space.s2) {
                InstrumentTile(label: String(localized: "GPS irtifa"), value: alt.0, unit: alt.1)
                InstrumentTile(label: String(localized: "Yer hızı"), value: speed.0, unit: speed.1)
            }
            SyncBadge(snapshot: model.syncSnapshot)
            Button { confirmEnd = true } label: { Label("İndim", systemImage: "arrow.down.to.line") }
                .buttonStyle(.aeroPrimaryLarge)
                .accessibilityIdentifier("pilot.end")
            Button { model.overlay = .flight } label: { Label("Uçuş ekranı", systemImage: "gauge.with.dots.needle.67percent") }
                .buttonStyle(.aeroInk)
                .accessibilityIdentifier("pilot.openFlight")
        }
    }
}

/// The pilot's open retrieve, inside the event sheet.
struct RetrievalStatusCard: View {
    @Environment(AppModel.self) private var model
    let retrieval: LocalRetrieval

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            HStack(spacing: AeroTokens.Space.s3) {
                Avatar(name: retrieval.server?.retriever?.fullName ?? "?", size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(retrieval.server?.retriever?.fullName ?? String(localized: "Retriever bekleniyor"))
                        .font(.headline)
                    Label(retrieval.stage.shortTitle, systemImage: retrieval.stage.systemImage)
                        .font(.subheadline).foregroundStyle(retrieval.stage.tone.color)
                }
                Spacer()
                Text(Fmt.relative(retrieval.createdAt)).font(.caption).foregroundStyle(AeroTokens.textMuted)
            }
            Button { model.overlay = .retrieval(retrieval.id) } label: { Label("Retrieve'ı takip et", systemImage: "map") }
                .buttonStyle(.aeroPrimary)
        }
        .padding(AeroTokens.Space.s4)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
    }
}

extension FlightSessionState {
    var titleValue: String.LocalizationValue {
        switch self {
        case .idle: "Kayıt yok"
        case .preparing: "GPS bekleniyor"
        case .recording: "Kaydediliyor"
        case .paused: "Duraklatıldı"
        case .ending: "Bitiriliyor"
        case .completed: "Tamamlandı"
        case .error: "Hata"
        }
    }
}

// MARK: Readiness

/// Pre-flight readiness: permission (incl. Always), precision, GPS fix,
/// battery, network, storage, background, notifications. Offline is allowed.
struct ReadinessList: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    var compact = false
    @State private var locator = OneShotLocator()
    @State private var conditions = DeviceConditions.unknown
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var expanded = false

    struct Item: Identifiable {
        let id: String
        let tone: Tone
        let text: String
        let icon: String
        var action: (title: LocalizedStringKey, run: () -> Void)?
    }

    private var auth: LocationAuthorization { model.session.authorization }

    var body: some View {
        let items = self.items
        let problems = items.filter { $0.tone != .success && $0.tone != .info }
        AeroCard {
            HStack {
                SectionHeader(title: String(localized: "Uçuş öncesi"))
                Spacer()
                if problems.isEmpty {
                    StatusPill(String(localized: "Hazır"), systemImage: "checkmark.seal", tone: .success)
                } else {
                    StatusPill(String(localized: "\(problems.count) uyarı"), systemImage: "exclamationmark.triangle", tone: .warning)
                }
            }
            ForEach(compact && !expanded ? items.filter { $0.tone == .error } : items) { item in row(item) }
            if compact {
                Button {
                    withAnimation(.snappy) { expanded.toggle() }
                } label: {
                    Label(expanded ? "Gizle" : "Kontrolleri göster", systemImage: expanded ? "chevron.up" : "chevron.down")
                }
                .font(.subheadline.weight(.semibold))
            }
        }
        .onAppear {
            conditions = DeviceStatus.current()
            locator.request()
            UNUserNotificationCenter.current().getNotificationSettings { s in
                let status = s.authorizationStatus
                Task { @MainActor in notificationStatus = status }
            }
        }
        .onChange(of: auth) { _, _ in locator.request() }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryLevelDidChangeNotification)) { _ in conditions = DeviceStatus.current() }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in conditions = DeviceStatus.current() }
    }

    private func row(_ item: Item) -> some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s1) {
            HStack(alignment: .top, spacing: AeroTokens.Space.s3) {
                Image(systemName: item.icon).foregroundStyle(item.tone.color).frame(width: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    Text(toneLabel(item.tone)).font(.caption2.weight(.semibold)).foregroundStyle(item.tone.color)
                }
            }
            if let action = item.action {
                Button(action.title, action: action.run).font(.subheadline.weight(.semibold)).padding(.leading, 34)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func toneLabel(_ tone: Tone) -> LocalizedStringKey {
        switch tone {
        case .success: "Hazır"
        case .warning: "Uyarı"
        case .error: "Engel"
        default: "Bilgi"
        }
    }

    private var settings: (title: LocalizedStringKey, run: () -> Void) {
        ("Ayarları aç", { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } })
    }

    private var items: [Item] {
        var out: [Item] = []
        // Permission
        if !auth.servicesEnabled {
            out.append(Item(id: "perm", tone: .error, text: String(localized: "Konum servisleri kapalı."), icon: "location.slash", action: settings))
        } else {
            switch auth.status {
            case .always:
                out.append(Item(id: "perm", tone: .success, text: String(localized: "Konum izni: Her Zaman. Ekran kilitliyken kayıt ve paylaşım sürer."), icon: "location.fill"))
            case .whenInUse:
                out.append(Item(id: "perm", tone: .warning, text: String(localized: "Konum izni: Kullanımdayken. Kayıt arka planda sürer ama \"Her Zaman\" iOS kesintilerinden sonra kendiliğinden devam etmeyi sağlar."),
                                icon: "location", action: ("\"Her Zaman\" iste", { model.session.requestAlwaysAuthorization() })))
            case .notDetermined:
                out.append(Item(id: "perm", tone: .warning, text: String(localized: "Konum izni henüz verilmedi."), icon: "location.circle",
                                action: ("İzin ver", { model.session.requestWhenInUseAuthorization() })))
            case .denied, .restricted:
                out.append(Item(id: "perm", tone: .error, text: String(localized: "Konum izni reddedildi. Uçuş kaydı için Ayarlar'dan izin ver."), icon: "location.slash", action: settings))
            }
        }
        if auth.canRecord {
            out.append(auth.fullAccuracy
                ? Item(id: "precise", tone: .success, text: String(localized: "Hassas konum açık."), icon: "scope")
                : Item(id: "precise", tone: .error, text: String(localized: "Yaklaşık konum seçili: iz ve retrieve konumu kilometrelerce hatalı olabilir."), icon: "scope",
                       action: ("Hassas konum iste", { (model.location as? LocationEngine)?.requestTemporaryFullAccuracy() })))
        }
        // GPS fix
        if let fix = locator.fix {
            let acc = fix.horizontalAccuracy
            out.append(Item(id: "fix", tone: acc <= 20 ? .success : (acc <= 50 ? .warning : .error),
                            text: String(localized: "GPS doğruluğu \(Fmt.accuracy(acc)) · \(Fmt.relative(fix.timestamp))"), icon: "location.north.circle",
                            action: ("Yenile", { locator.request() })))
        } else if auth.canRecord {
            out.append(Item(id: "fix", tone: .info, text: locator.failed ? String(localized: "Henüz GPS konumu yok. Açık gökyüzü altında bekle.") : String(localized: "GPS konumu alınıyor…"),
                            icon: "location.magnifyingglass", action: ("Yenile", { locator.request() })))
        }
        // Battery
        if conditions.lowPowerMode {
            out.append(Item(id: "lpm", tone: .warning, text: String(localized: "Düşük Güç Modu açık: iOS konum güncellemelerini seyrekleştirebilir."), icon: "battery.25percent"))
        }
        if let level = conditions.batteryLevel {
            out.append(Item(id: "battery", tone: level < 0.2 ? .error : (level < 0.4 ? .warning : .success),
                            text: String(localized: "Pil \(Fmt.battery(level))") + (conditions.batteryState == .charging ? String(localized: " · şarj oluyor") : ""),
                            icon: level < 0.4 ? "battery.25percent" : "battery.100percent"))
        } else {
            out.append(Item(id: "battery", tone: .info, text: String(localized: "Pil seviyesi okunamıyor (simülatör)."), icon: "battery.0percent"))
        }
        // Network
        out.append(model.networkStatus.isConnected
            ? Item(id: "net", tone: .success, text: String(localized: "İnternet bağlantısı var") + (model.networkStatus.isConstrained ? String(localized: " (Düşük Veri Modu)") : ""), icon: "wifi")
            : Item(id: "net", tone: .warning, text: String(localized: "Bağlantı yok. Kayıt çevrimdışı yapılır; canlı haritada görünmezsin, retrieve talebi bağlantı gelince gönderilir."), icon: "wifi.slash"))
        // Storage
        if let free = Self.freeBytes() {
            out.append(Item(id: "storage", tone: free < 200_000_000 ? .warning : .success, text: String(localized: "Boş alan \(Fmt.bytes(free))"), icon: "internaldrive"))
        }
        // Background
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        if !modes.contains("location") {
            out.append(Item(id: "bg", tone: .error, text: String(localized: "Uygulama arka plan konumu için yapılandırılmamış."), icon: "exclamationmark.octagon"))
        } else {
            out.append(Item(id: "bg", tone: auth.status == .always && !conditions.lowPowerMode ? .success : .warning,
                            text: String(localized: "Uygulamayı uygulama değiştiriciden kaydırarak kapatma; kapatırsan iOS konum vermeyi durdurur."), icon: "hand.raised"))
        }
        // Notifications (landing reminder in the background)
        if notificationStatus == .notDetermined {
            out.append(Item(id: "notif", tone: .info, text: String(localized: "Bildirim izni: uygulama arka plandayken iniş hatırlatması için."), icon: "bell",
                            action: ("Bildirimlere izin ver", {
                                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { ok, _ in
                                    Task { @MainActor in notificationStatus = ok ? .authorized : .denied }
                                }
                            })))
        }
        let pending = (try? model.store.pendingCount()) ?? 0
        if pending > 0 && !model.session.isActive {
            out.append(Item(id: "pending", tone: .info, text: String(localized: "Önceki uçuşlardan \(pending) nokta henüz gönderilmedi; bağlantı gelince gönderilir."), icon: "tray.full"))
        }
        if model.isSimulatedBuild {
            out.append(Item(id: "sim", tone: .info, text: String(localized: "Simülatör/test: konumlar simüle edilir ve uçuş SIM olarak işaretlenir. Gerçek cihaz doğrulaması değildir."), icon: "desktopcomputer"))
        }
        return out
    }

    static func freeBytes() -> Int64? {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        return (try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage
    }
}
