import RetfastCore
import SwiftUI
import UIKit

/// Full-screen cover, independent of the tab hierarchy. Closing it only hides
/// the UI; recording continues in `FlightSessionManager`.
struct FlightComputerContainer: View {
    @Environment(AppModel.self) private var model
    @AppStorage("fcTheme") private var themeRaw = FlightComputerTheme.auto.rawValue

    private var theme: FlightComputerTheme { FlightComputerTheme(rawValue: themeRaw) ?? .auto }
    private var scheme: ColorScheme? {
        switch theme {
        case .auto: nil
        case .dark: .dark
        case .light, .highContrast: .light
        }
    }

    var body: some View {
        Group {
            switch model.session.state {
            case .completed:
                NavigationStack { FlightSummaryView() }
            case .idle:
                // Nothing to show (e.g. reset elsewhere): close the cover.
                Color.clear.onAppear { if model.overlay == .flight { model.overlay = nil } }
            default:
                FlightComputerView(highContrast: theme == .highContrast)
            }
        }
        .preferredColorScheme(scheme)
        .environment(\.legibilityWeight, theme == .highContrast ? .bold : nil)
    }
}

struct FlightComputerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let highContrast: Bool
    @State private var showMap = false
    @State private var confirmEnd = false
    @State private var conditions = DeviceConditions.unknown

    private var session: FlightSessionManager { model.session }
    private var v: FlightComputerValues { session.values }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if showMap {
                FlightLiveMapView()
            } else {
                ScrollView {
                    VStack(spacing: AeroTokens.Space.s3) {
                        hero
                        banners
                        instruments
                    }
                    .padding(.horizontal, AeroTokens.Space.s4)
                    .padding(.bottom, AeroTokens.Space.s4)
                }
            }
            controls
        }
        .background((highContrast ? Color.white : AeroTokens.background).ignoresSafeArea())
        .onAppear {
            conditions = DeviceStatus.current()
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .onReceive(Timer.publish(every: 30, on: .main, in: .common).autoconnect()) { _ in conditions = DeviceStatus.current() }
        .confirmationDialog("Uçuşu bitir?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("Uçuşu bitir", role: .destructive) { model.endFlight() }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Kayıt durdurulur. Gönderilmemiş noktalar bağlantı gelince gönderilmeye devam eder.")
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: AeroTokens.Space.s2) {
            MapCircleButton(systemImage: "chevron.down", label: "Küçült (kayıt devam eder)") { model.overlay = nil }
                .accessibilityIdentifier("fc.minimize")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AeroTokens.Space.s2) {
                    StatusPill(String(localized: stateText), systemImage: session.state.systemImage, tone: session.state.tone)
                        .accessibilityIdentifier("fc.state")
                    SyncBadge(snapshot: model.syncSnapshot)
                    StatusPill(Fmt.battery(conditions.batteryLevel) + (conditions.lowPowerMode ? " · LPM" : ""),
                               systemImage: conditions.lowPowerMode ? "battery.25percent" : "battery.75percent",
                               tone: (conditions.batteryLevel ?? 1) < 0.2 ? .error : .neutral)
                    if session.flight?.isSimulated == true { SimBadge() }
                }
            }

            if model.session.flight?.eventId != nil {
                Button {
                    model.showLandingPrompt = true
                } label: {
                    Label("İndim", systemImage: "arrow.down.to.line")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(AeroTokens.onPrimary)
                        .padding(.horizontal, AeroTokens.Space.s4)
                        .frame(minHeight: 44)
                        .background(AeroTokens.primary, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text("Uçuşu bitirme ve retrieve isteme seçeneklerini açar"))
                .accessibilityIdentifier("fc.landed")
            }
        }
        .padding(.horizontal, AeroTokens.Space.s4)
        .padding(.vertical, AeroTokens.Space.s2)
    }

    /// Big flight timer + the three numbers a pilot glances at.
    private var hero: some View {
        let alt = Fmt.altitude(v.gpsAltitude)
        let speed = Fmt.speed(v.groundSpeed)
        let vario = Fmt.vario(v.verticalSpeed)
        return VStack(spacing: AeroTokens.Space.s3) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(Fmt.duration(context.date.timeIntervalSince(session.flight?.startedAt ?? context.date)))
                    .font(.system(size: 64, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(highContrast ? Color.black : AeroTokens.textPrimary)
                    .minimumScaleFactor(0.6)
                    .accessibilityLabel(Text("Uçuş süresi"))
            }
            HStack(spacing: 0) {
                heroValue(String(localized: "İrtifa"), alt.0, alt.1).accessibilityIdentifier("fc.altitude")
                Divider().frame(height: 44)
                heroValue(String(localized: "Hız"), speed.0, speed.1)
                Divider().frame(height: 44)
                heroValue(String(localized: "Dikey"), vario.0, vario.1)
            }
        }
        .padding(.vertical, AeroTokens.Space.s4)
        .frame(maxWidth: .infinity)
        .background(highContrast ? Color.white : AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.xl, style: .continuous))
    }

    private func heroValue(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(.system(size: 28, weight: .bold, design: .rounded).monospacedDigit())
                Text(unit).font(.caption.weight(.semibold)).foregroundStyle(AeroTokens.textSecondary)
            }
            Text(label).font(.caption).foregroundStyle(AeroTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var stateText: String.LocalizationValue {
        switch session.state {
        case .preparing: "GPS bekleniyor"
        case .recording: "Kaydediliyor"
        case .paused: "Duraklatıldı"
        case .ending: "Bitiriliyor"
        case .error: "Hata"
        case .completed: "Tamamlandı"
        case .idle: "Kayıt yok"
        }
    }

    // MARK: Banners

    @ViewBuilder private var banners: some View {
        if let since = session.interruptedSince {
            AeroCard {
                WarningRow(text: String(localized: "Kayıt \(Fmt.time(since)) sonrasında kesildi (uygulama kapatıldı veya iOS sonlandırdı) ve yeniden başlatıldı. Aradaki süre izde boşluk olarak görünür."))
            }
        }
        if let error = session.lastError {
            AeroCard { WarningRow(text: errorText(error), tone: .error) }
        }
        if session.state == .preparing {
            AeroCard {
                WarningRow(text: String(localized: "GPS konumu bekleniyor. Açık gökyüzü altında kalın; ilk iyi konum gelince kayıt başlar."), tone: .info, systemImage: "location.magnifyingglass")
            }
        }
        if session.state == .paused {
            AeroCard {
                WarningRow(text: String(localized: "Kayıt duraklatıldı. GPS kapalı; bu sürede konum kaydedilmez ve canlı haritada güncellenmezsiniz."), tone: .warning, systemImage: "pause.circle")
            }
        }
        if session.state == .recording {
            TimelineView(.periodic(from: .now, by: 5)) { context in
                if let last = v.lastFixAt, context.date.timeIntervalSince(last) > 15 {
                    AeroCard {
                        WarningRow(text: String(localized: "Son GPS konumu \(Fmt.age(context.date.timeIntervalSince(last))) önce alındı. Telefonu gökyüzünü görecek şekilde tutun."))
                    }
                }
            }
        }
        if v.lowQuality {
            AeroCard { WarningRow(text: String(localized: "GPS doğruluğu düşük (\(Fmt.accuracy(v.horizontalAccuracy))). Noktalar kaydediliyor ancak istatistiklere katılmıyor.")) }
        }
        if session.state == .recording && session.profile == .landing {
            AeroCard {
                WarningRow(text: String(localized: "İniş algılandı (düşük hız, düşük dikey hız). Kayıt sen bitirene kadar sürer."), tone: .info, systemImage: "arrow.down.to.line")
            }
        }
    }

    private func errorText(_ code: String) -> String {
        switch code {
        case "location_permission_revoked": String(localized: "Konum izni kaldırıldı. Kayıt konum alamıyor; Ayarlar'dan izni geri verin.")
        case "storage_write_failed": String(localized: "Noktalar telefona yazılamıyor (depolama hatası). Boş alanı kontrol edin.")
        case "location_permission_denied": String(localized: "Konum izni yok.")
        default: String(localized: "Kayıt hatası: \(code)")
        }
    }

    // MARK: Instruments

    private var instruments: some View {
        let dist = Fmt.distance(v.distance)
        let maxAlt = Fmt.altitude(v.maxAltitude)
        let maxSpeed = Fmt.speed(v.maxGroundSpeed)
        let up = Fmt.altitude(v.totalAscent)
        let down = Fmt.altitude(v.totalDescent)

        return VStack(spacing: AeroTokens.Space.s3) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: AeroTokens.Space.s3)], spacing: AeroTokens.Space.s3) {
                InstrumentTile(label: String(localized: "GPS doğruluğu"), value: Fmt.accuracy(v.horizontalAccuracy),
                               tone: (v.horizontalAccuracy ?? 999) > 50 ? .error : ((v.horizontalAccuracy ?? 999) > 20 ? .warning : .neutral),
                               highContrast: highContrast)
                InstrumentTile(label: String(localized: "Yön"), value: Fmt.heading(v.heading), highContrast: highContrast)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: AeroTokens.Space.s2)], spacing: AeroTokens.Space.s2) {
                InstrumentTile(label: String(localized: "Mesafe"), value: dist.0, unit: dist.1, highContrast: highContrast)
                InstrumentTile(label: String(localized: "Maks irtifa"), value: maxAlt.0, unit: maxAlt.1, highContrast: highContrast)
                InstrumentTile(label: String(localized: "Maks hız"), value: maxSpeed.0, unit: maxSpeed.1, highContrast: highContrast)
                InstrumentTile(label: String(localized: "Toplam tırmanış"), value: up.0, unit: up.1, highContrast: highContrast)
                InstrumentTile(label: String(localized: "Toplam alçalma"), value: down.0, unit: down.1, highContrast: highContrast)
                InstrumentTile(label: String(localized: "Nokta"), value: "\(session.storedSampleCount)", highContrast: highContrast)
            }
            HStack {
                StatusPill(String(localized: "Profil: ") + profileName, systemImage: "slider.horizontal.3", tone: .info)
                Spacer()
                if let ack = model.syncSnapshot.lastServerAck {
                    Text("Son sunucu onayı \(Fmt.time(ack))").font(.caption).foregroundStyle(AeroTokens.textSecondary)
                }
            }
            Text("Değerler GPS'ten hesaplanır. İrtifa GPS irtifasıdır; dikey hız filtrelenmiş bir tahmindir ve variometre yerine geçmez.")
                .font(.caption2).foregroundStyle(AeroTokens.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var profileName: String {
        switch session.profile {
        case .preFlight: String(localized: "Kalkış öncesi")
        case .activeFlight: String(localized: "Uçuş")
        case .thermal: String(localized: "Termik")
        case .cruise: String(localized: "Seyir")
        case .landing: String(localized: "İniş")
        case .retrieveWaiting: String(localized: "Retrieve bekleniyor")
        case .retrieverDriving: String(localized: "Retrieve görevi")
        }
    }

    // MARK: Controls

    private var controls: some View {
        VStack(spacing: AeroTokens.Space.s3) {
            CapsuleSegment(selection: $showMap, options: [(false, String(localized: "Göstergeler")), (true, String(localized: "Canlı harita"))])
                .accessibilityIdentifier("fc.mode")
            HStack(spacing: AeroTokens.Space.s3) {
                if session.state == .paused || session.state == .error {
                    Button {
                        try? session.resume()
                        Haptics.start()
                    } label: { Label("Devam et", systemImage: "play.fill") }
                    .buttonStyle(.aeroPrimary)
                } else {
                    Button {
                        try? session.pause()
                        Haptics.tick()
                    } label: { Label("Duraklat", systemImage: "pause.fill") }
                    .buttonStyle(.aeroSecondary)
                    .disabled(session.state != .recording)
                }
                Button {
                    confirmEnd = true
                } label: { Label("Bitir", systemImage: "stop.fill") }
                .buttonStyle(.aeroInk)
                .accessibilityIdentifier("fc.end")
            }
        }
        .padding(.horizontal, AeroTokens.Space.s4)
        .padding(.top, AeroTokens.Space.s4)
        .padding(.bottom, AeroTokens.Space.s2)
        .background {
            UnevenRoundedRectangle(topLeadingRadius: AeroTokens.Radius.xl, topTrailingRadius: AeroTokens.Radius.xl, style: .continuous)
                .fill(AeroTokens.surface)
                .shadow(color: .black.opacity(0.12), radius: 12, y: -2)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

struct FlightSummaryView: View {
    @Environment(AppModel.self) private var model
    @State private var counts = LocalTelemetryStore.SyncCounts()

    var body: some View {
        let v = model.session.values
        let f = model.session.flight
        List {
            Section {
                VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
                    Label("Uçuş kaydedildi", systemImage: "checkmark.circle.fill")
                        .font(.title2.bold()).foregroundStyle(AeroTokens.success)
                    if let name = f?.eventName { Text(name).foregroundStyle(AeroTokens.textSecondary) }
                    if f?.isSimulated == true { SimBadge() }
                }
            }
            Section {
                if let f, let eventId = f.eventId?.uuidString.lowercased(), model.activeRetrieval(eventId: eventId) == nil {
                    Button {
                        model.retrieveRequest = RetrieveContext(eventId: eventId, eventName: f.eventName, flightId: f.id)
                    } label: { Label("Retrieve iste", systemImage: "car.fill") }
                    .buttonStyle(.aeroPrimaryLarge)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .accessibilityIdentifier("summary.retrieve")
                }
                Button(f?.eventId != nil ? "Retrieve gerekmez, kapat" : "Tamam") {
                    model.session.reset()
                    model.overlay = nil
                }
                .buttonStyle(.aeroSecondary)
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                .accessibilityIdentifier("summary.done")
            }
            Section("Özet") {
                KeyValueRow(key: String(localized: "Süre"), value: Fmt.duration((f?.endedAt ?? Date()).timeIntervalSince(f?.startedAt ?? Date())), mono: true)
                KeyValueRow(key: String(localized: "Mesafe"), value: Fmt.distance(v.distance).0 + " " + Fmt.distance(v.distance).1, mono: true)
                KeyValueRow(key: String(localized: "Maks GPS irtifa"), value: Fmt.altitude(v.maxAltitude).0 + " " + Fmt.altitude(v.maxAltitude).1, mono: true)
                KeyValueRow(key: String(localized: "Maks yer hızı"), value: Fmt.speed(v.maxGroundSpeed).0 + " " + Fmt.speed(v.maxGroundSpeed).1, mono: true)
                KeyValueRow(key: String(localized: "Toplam tırmanış"), value: Fmt.altitude(v.totalAscent).0 + " " + Fmt.altitude(v.totalAscent).1, mono: true)
                KeyValueRow(key: String(localized: "Kaydedilen nokta"), value: "\(model.session.storedSampleCount)", mono: true)
                if let n = f?.interruptionCount, n > 0 {
                    KeyValueRow(key: String(localized: "Kesinti"), value: "\(n)")
                }
            }
            Section("Senkronizasyon") {
                SyncBadge(snapshot: model.syncSnapshot)
                KeyValueRow(key: String(localized: "Sunucuya ulaşan"), value: "\(counts.synced)")
                KeyValueRow(key: String(localized: "Bekleyen"), value: "\(counts.pending)")
                if counts.rejected > 0 { KeyValueRow(key: String(localized: "Sunucunun reddettiği"), value: "\(counts.rejected)") }
                if counts.pending > 0 {
                    Text("Bekleyen noktalar telefonda saklanır ve bağlantı gelince otomatik gönderilir. Uygulamayı açık tutmak gönderimi hızlandırır.")
                        .font(.footnote).foregroundStyle(AeroTokens.textSecondary)
                }
            }
        }
        .navigationTitle("Uçuş özeti")
        .task(id: model.syncSnapshot) {
            if let id = f?.id { counts = (try? model.store.syncCounts(flightId: id)) ?? counts }
        }
    }
}
