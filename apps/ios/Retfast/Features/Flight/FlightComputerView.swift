import RetfastCore
import SwiftUI
import UIKit

/// Full-screen cover for the flight. While recording, the flight lives in the
/// event screen's bottom panel, so this only shows the post-flight summary.
struct FlightComputerContainer: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.session.state {
        case .completed:
            NavigationStack { FlightSummaryView() }
        default:
            Color.clear.onAppear {
                if model.overlay == .flight { model.overlay = nil }
                if model.session.isActive { model.openFlightEvent() }
            }
        }
    }
}

/// The flight, inside the event screen's bottom sheet: timer, the numbers a
/// pilot glances at, warnings, and İndim / Duraklat / Bitir.
struct FlightPanel: View {
    @Environment(AppModel.self) private var model
    @Binding var confirmEnd: Bool

    private var session: FlightSessionManager { model.session }
    private var v: FlightComputerValues { session.values }

    var body: some View {
        VStack(spacing: AeroTokens.Space.s3) {
            HStack(spacing: AeroTokens.Space.s2) {
                StatusPill(String(localized: stateText), systemImage: session.state.systemImage, tone: session.state.tone)
                    .accessibilityIdentifier("fc.state")
                SyncBadge(snapshot: model.syncSnapshot)
                if session.flight?.isSimulated == true { SimBadge() }
                Spacer(minLength: 0)
            }
            hero
            Button {
                model.showLandingPrompt = true
            } label: { Label("İndim", systemImage: "arrow.down.to.line") }
            .buttonStyle(.aeroPrimaryLarge)
            .accessibilityHint(Text("Uçuşu bitirme ve retrieve isteme seçeneklerini açar"))
            .accessibilityIdentifier("fc.landed")
            controls
            banners
            stats
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    private var hero: some View {
        let alt = Fmt.altitude(v.gpsAltitude)
        let speed = Fmt.speed(v.groundSpeed)
        let vario = Fmt.vario(v.verticalSpeed)
        return VStack(spacing: AeroTokens.Space.s3) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(Fmt.duration(context.date.timeIntervalSince(session.flight?.startedAt ?? context.date)))
                    .font(.system(size: 56, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(AeroTokens.textPrimary)
                    .minimumScaleFactor(0.6)
                    .accessibilityLabel(Text("Uçuş süresi"))
            }
            HStack(spacing: 0) {
                heroValue(String(localized: "İrtifa"), alt.0, alt.1).accessibilityIdentifier("fc.altitude")
                Divider().frame(height: 40)
                heroValue(String(localized: "Hız"), speed.0, speed.1)
                Divider().frame(height: 40)
                heroValue(String(localized: "Dikey"), vario.0, vario.1)
            }
        }
        .padding(.vertical, AeroTokens.Space.s4)
        .frame(maxWidth: .infinity)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.xl, style: .continuous))
    }

    private func heroValue(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(.system(size: 26, weight: .bold, design: .rounded).monospacedDigit())
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

    @ViewBuilder private var banners: some View {
        if let since = session.interruptedSince {
            WarningRow(text: String(localized: "Kayıt \(Fmt.time(since)) sonrasında kesildi ve yeniden başladı. Aradaki süre izde boşluk olarak görünür."))
        }
        if let error = session.lastError {
            WarningRow(text: errorText(error), tone: .error)
        }
        if session.state == .preparing {
            WarningRow(text: String(localized: "GPS konumu bekleniyor. Açık gökyüzü altında kal; ilk iyi konumla kayıt başlar."), tone: .info, systemImage: "location.magnifyingglass")
        }
        if session.state == .paused {
            WarningRow(text: String(localized: "Kayıt duraklatıldı; bu sürede konum kaydedilmez."), tone: .warning, systemImage: "pause.circle")
        }
        if session.state == .recording {
            TimelineView(.periodic(from: .now, by: 5)) { context in
                if let last = v.lastFixAt, context.date.timeIntervalSince(last) > 15 {
                    WarningRow(text: String(localized: "Son GPS konumu \(Fmt.age(context.date.timeIntervalSince(last))) önce alındı."))
                }
            }
        }
        if v.lowQuality {
            WarningRow(text: String(localized: "GPS doğruluğu düşük (\(Fmt.accuracy(v.horizontalAccuracy)))."))
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

    private var stats: some View {
        let dist = Fmt.distance(v.distance)
        let maxAlt = Fmt.altitude(v.maxAltitude)
        let up = Fmt.altitude(v.totalAscent)
        return HStack(spacing: AeroTokens.Space.s2) {
            InstrumentTile(label: String(localized: "Mesafe"), value: dist.0, unit: dist.1)
            InstrumentTile(label: String(localized: "Maks irtifa"), value: maxAlt.0, unit: maxAlt.1)
            InstrumentTile(label: String(localized: "Tırmanış"), value: up.0, unit: up.1)
        }
    }

    private var controls: some View {
        HStack(spacing: AeroTokens.Space.s3) {
            if session.state == .paused || session.state == .error {
                Button {
                    try? session.resume()
                    Haptics.start()
                } label: { Label("Devam et", systemImage: "play.fill") }
                .buttonStyle(.aeroSecondary)
            } else {
                Button {
                    try? session.pause()
                    Haptics.tick()
                } label: { Label("Duraklat", systemImage: "pause.fill") }
                .buttonStyle(.aeroSecondary)
                .disabled(session.state != .recording)
            }
            Button { confirmEnd = true } label: { Label("Bitir", systemImage: "stop.fill") }
                .buttonStyle(.aeroInk)
                .accessibilityIdentifier("fc.end")
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
