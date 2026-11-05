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
                FlightPanel(confirmEnd: $confirmEnd)
            } else if model.session.isActive {
                AeroCard {
                    WarningRow(text: String(localized: "Başka bir etkinlikte (\(model.session.flight?.eventName ?? "—")) uçuş kaydı sürüyor. Önce onu bitir."))
                    Button("O etkinliğe git") { model.openFlightEvent() }.buttonStyle(.aeroSecondary)
                }
            } else if let r = model.activeRetrieval(eventId: event.id) {
                RetrievalStatusCard(retrieval: r)
            } else {
                startSection
            }
        }
        .alert("Uçuşu bitir?", isPresented: $confirmEnd) {
            Button("Uçuşu bitir") { model.endFlightAndRequestRetrieve() }
            Button("Uçmaya devam", role: .cancel) {}
        } message: {
            Text("Kayıt durur ve retrieve isteme ekranı açılır.")
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
            Label("Uçuşa başla", icon: "paperplane.fill")
        }
        .buttonStyle(.aeroPrimaryLarge)
        .disabled(!canStart)
        .accessibilityIdentifier("pilot.start")
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
                    WeatherCard(event: event)
                }
                .padding(AeroTokens.Space.s4)
            }
            Button(action: onContinue) {
                Label("Devam", icon: "arrow.right")
            }
            .buttonStyle(.aeroPrimaryLarge)
            .accessibilityIdentifier("preflight.next")
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.bottom, AeroTokens.Space.s2)
        }
        .aeroBackground()
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
                    Label(retrieval.stage.shortTitle, icon: retrieval.stage.systemImage)
                        .font(.subheadline).foregroundStyle(retrieval.stage.tone.color)
                }
                Spacer()
                Text(Fmt.relative(retrieval.createdAt)).font(.caption).foregroundStyle(AeroTokens.textMuted)
            }
            Button { model.overlay = .retrieval(retrieval.id) } label: { Label("Retrieve'ı takip et", icon: "map") }
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

/// Pre-flight readiness as separate cards: location permission, precision,
/// GPS fix, background note, notifications. Only what affects tracking;
/// no device inventory (battery/storage/network) on purpose.
struct ReadinessList: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var locator = OneShotLocator()
    @State private var lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined

    struct Item: Identifiable {
        let id: String
        let tone: Tone
        let title: String
        var detail: String?
        let icon: String
        var action: (title: LocalizedStringKey, run: () -> Void)?
    }

    private var auth: LocationAuthorization { model.session.authorization }

    var body: some View {
        VStack(spacing: AeroTokens.Space.s3) {
            ForEach(items) { card($0) }
        }
        .onAppear {
            locator.request()
            UNUserNotificationCenter.current().getNotificationSettings { s in
                let status = s.authorizationStatus
                Task { @MainActor in notificationStatus = status }
            }
        }
        .onChange(of: auth) { _, _ in locator.request() }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            Task { @MainActor in lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled }
        }
    }

    private func card(_ item: Item) -> some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            HStack(alignment: .center, spacing: AeroTokens.Space.s3) {
                Image(icon: item.icon)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(item.tone.color)
                    .frame(width: 48, height: 48)
                    .background(item.tone.color.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.headline).foregroundStyle(AeroTokens.textPrimary)
                    if let d = item.detail {
                        Text(d).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                statusMark(item.tone)
            }
            if let action = item.action {
                Button(action: action.run) {
                    Text(action.title).font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(AeroTokens.background, in: Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(AeroTokens.textPrimary)
            }
        }
        .padding(AeroTokens.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("preflight.check.\(item.id)")
    }

    @ViewBuilder private func statusMark(_ tone: Tone) -> some View {
        switch tone {
        case .success:
            Image(icon: "checkmark.circle.fill").font(.title2).foregroundStyle(AeroTokens.success)
                .accessibilityLabel(Text("Hazır"))
        case .error:
            Image(icon: "xmark.circle.fill").font(.title2).foregroundStyle(AeroTokens.error)
                .accessibilityLabel(Text("Engel"))
        case .warning:
            Image(icon: "exclamationmark.circle.fill").font(.title2).foregroundStyle(AeroTokens.warning)
                .accessibilityLabel(Text("Uyarı"))
        default:
            EmptyView()
        }
    }

    private var settings: (title: LocalizedStringKey, run: () -> Void) {
        ("Ayarları aç", { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } })
    }

    private var items: [Item] {
        var out: [Item] = []
        // Permission
        if !auth.servicesEnabled {
            out.append(Item(id: "perm", tone: .error, title: String(localized: "Konum servisleri kapalı"),
                            detail: String(localized: "Uçuş kaydı için Ayarlar'dan aç."), icon: "location.slash", action: settings))
        } else {
            switch auth.status {
            case .always:
                out.append(Item(id: "perm", tone: .success, title: String(localized: "Konum izni"),
                                detail: String(localized: "Her Zaman · ekran kilitliyken de kayıt sürer."), icon: "location.fill"))
            case .whenInUse:
                out.append(Item(id: "perm", tone: .warning, title: String(localized: "Konum izni"),
                                detail: String(localized: "Kullanımdayken · \"Her Zaman\" kesintilerden sonra kaydın kendiliğinden sürmesini sağlar."),
                                icon: "location", action: ("\"Her Zaman\" iste", { model.session.requestAlwaysAuthorization() })))
            case .notDetermined:
                out.append(Item(id: "perm", tone: .warning, title: String(localized: "Konum izni"),
                                detail: String(localized: "Henüz verilmedi."), icon: "location.circle",
                                action: ("İzin ver", { model.session.requestWhenInUseAuthorization() })))
            case .denied, .restricted:
                out.append(Item(id: "perm", tone: .error, title: String(localized: "Konum izni"),
                                detail: String(localized: "Reddedildi. Uçuş kaydı için Ayarlar'dan izin ver."), icon: "location.slash", action: settings))
            }
        }
        if auth.canRecord {
            out.append(auth.fullAccuracy
                ? Item(id: "precise", tone: .success, title: String(localized: "Hassas konum"), detail: String(localized: "Açık"), icon: "scope")
                : Item(id: "precise", tone: .error, title: String(localized: "Hassas konum"),
                       detail: String(localized: "Yaklaşık konum seçili; iz ve alınma noktası hatalı olur."), icon: "scope",
                       action: ("Hassas konum iste", { (model.location as? LocationEngine)?.requestTemporaryFullAccuracy() })))
        }
        // GPS fix
        if let fix = locator.fix {
            let acc = fix.horizontalAccuracy
            out.append(Item(id: "fix", tone: acc <= 20 ? .success : (acc <= 50 ? .warning : .error),
                            title: String(localized: "GPS sinyali"),
                            detail: String(localized: "Doğruluk \(Fmt.accuracy(acc)) · \(Fmt.relative(fix.timestamp))"),
                            icon: "location.north.circle",
                            action: acc <= 20 ? nil : ("Yenile", { locator.request() })))
        } else if auth.canRecord {
            out.append(Item(id: "fix", tone: .info, title: String(localized: "GPS sinyali"),
                            detail: locator.failed ? String(localized: "Henüz konum yok. Açık gökyüzü altında bekle.") : String(localized: "Konum alınıyor…"),
                            icon: "location.magnifyingglass", action: ("Yenile", { locator.request() })))
        }
        if lowPowerMode {
            out.append(Item(id: "lpm", tone: .warning, title: String(localized: "Düşük Güç Modu"),
                            detail: String(localized: "Açıkken iOS konum güncellemelerini seyrekleştirebilir."), icon: "bolt.slash"))
        }
        // Background
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        if !modes.contains("location") {
            out.append(Item(id: "bg", tone: .error, title: String(localized: "Arka plan konumu"),
                            detail: String(localized: "Uygulama arka plan konumu için yapılandırılmamış."), icon: "exclamationmark.octagon"))
        } else {
            out.append(Item(id: "bg", tone: .info, title: String(localized: "Uygulamayı kapatma"),
                            detail: String(localized: "Uçarken uygulamayı yukarı kaydırıp kapatırsan kayıt durur."), icon: "hand.raised"))
        }
        // Notifications (landing reminder in the background)
        switch notificationStatus {
        case .notDetermined:
            out.append(Item(id: "notif", tone: .warning, title: String(localized: "Bildirimler"),
                            detail: String(localized: "İniş hatırlatması için izin ver."), icon: "bell",
                            action: ("Bildirimlere izin ver", {
                                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { ok, _ in
                                    Task { @MainActor in notificationStatus = ok ? .authorized : .denied }
                                }
                            })))
        case .denied:
            out.append(Item(id: "notif", tone: .warning, title: String(localized: "Bildirimler"),
                            detail: String(localized: "Kapalı · iniş hatırlatması gelmez."), icon: "bell.slash", action: settings))
        default:
            out.append(Item(id: "notif", tone: .success, title: String(localized: "Bildirimler"), detail: String(localized: "Açık"), icon: "bell.fill"))
        }
        if model.isSimulatedBuild {
            out.append(Item(id: "sim", tone: .info, title: String(localized: "Test modu"),
                            detail: String(localized: "Konumlar simüle edilir; uçuş SIM olarak işaretlenir."), icon: "testtube.2"))
        }
        return out
    }
}
