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
/// pilot glances at, warnings, one "End flight" action and SOS. Ending goes
/// straight to the retrieve request (which also offers "no retrieve").
struct FlightPanel: View {
    @Environment(AppModel.self) private var model
    @Binding var confirmEnd: Bool
    @State private var showSOS = false

    private var session: FlightSessionManager { model.session }
    private var v: FlightComputerValues { session.values }

    var body: some View {
        VStack(spacing: AeroTokens.Space.s3) {
            header
            grid
            banners
            HStack(spacing: AeroTokens.Space.s3) {
                Button { showSOS = true } label: {
                    Label("SOS", icon: "siren")
                        .font(.headline.weight(.heavy))
                        .frame(maxWidth: 110, minHeight: AeroTokens.Control.heightLarge)
                        .foregroundStyle(AeroTokens.onEmergency)
                        .background(AeroTokens.emergency, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("fc.sos")
                .accessibilityHint(Text("Acil durum seçeneklerini açar"))

                if session.state == .paused || session.state == .error {
                    Button { try? session.resume(); Haptics.start() } label: { Label("Devam et", icon: "play.fill") }
                        .buttonStyle(.aeroSecondary)
                }
                Button { confirmEnd = true } label: { Label("Uçuşu bitir", icon: "flag.fill") }
                    .buttonStyle(.aeroPrimaryLarge)
                    .accessibilityIdentifier("fc.end")
                    .accessibilityHint(Text("Kaydı bitirir ve retrieve isteme ekranını açar"))
            }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .sheet(isPresented: $showSOS) { EmergencySheet().environment(model) }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: AeroTokens.Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Circle().fill(stateColor).frame(width: 8, height: 8)
                        .phaseAnimator([1.0, 0.3]) { c, o in c.opacity(session.state == .recording ? o : 1) } animation: { _ in .easeInOut(duration: 0.9) }
                    Text(String(localized: stateText))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(stateColor)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("fc.state")
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(Fmt.duration(context.date.timeIntervalSince(session.flight?.startedAt ?? context.date)))
                        .font(.system(size: 48, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(AeroTokens.textPrimary)
                        .contentTransition(.numericText())
                        .minimumScaleFactor(0.6)
                        .accessibilityLabel(Text("Uçuş süresi"))
                }
            }
            Spacer(minLength: 0)
            if session.flight?.isSimulated == true { SimBadge() }
            syncDot
        }
    }

    /// Quiet sync indicator: only an icon, coloured when something is waiting.
    private var syncDot: some View {
        let s = model.syncSnapshot
        let ok = s.status == .synced || (s.status == .syncing && s.pendingCount < 30)
        return Image(icon: ok ? "checkmark.icloud" : "icloud.slash")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(ok ? AeroTokens.textMuted : AeroTokens.warning)
            .frame(width: 40, height: 40)
            .background(AeroTokens.surface, in: Circle())
            .accessibilityLabel(Text(ok ? "Veriler gönderiliyor" : "Bekleyen veri: \(s.pendingCount)"))
    }

    private var stateColor: Color {
        switch session.state {
        case .recording: AeroTokens.emergency
        case .error: AeroTokens.error
        case .preparing, .paused, .ending: AeroTokens.warning
        default: AeroTokens.textMuted
        }
    }

    private var grid: some View {
        let alt = Fmt.altitude(v.gpsAltitude)
        let speed = Fmt.speed(v.groundSpeed)
        let vario = Fmt.vario(v.verticalSpeed)
        let dist = Fmt.distance(v.distance)
        let climbing = (v.verticalSpeed ?? 0) > 0.3
        let sinking = (v.verticalSpeed ?? 0) < -1.5
        return Grid(horizontalSpacing: AeroTokens.Space.s2, verticalSpacing: AeroTokens.Space.s2) {
            GridRow {
                FlightValue(label: String(localized: "İrtifa"), value: alt.0, unit: alt.1, icon: "mountain.2")
                    .accessibilityIdentifier("fc.altitude")
                FlightValue(label: String(localized: "Dikey"), value: vario.0, unit: vario.1,
                            icon: climbing ? "arrow.up" : (sinking ? "arrow.down" : "minus"),
                            tint: climbing ? AeroTokens.success : (sinking ? AeroTokens.error : nil))
            }
            GridRow {
                FlightValue(label: String(localized: "Yer hızı"), value: speed.0, unit: speed.1, icon: "gauge")
                FlightValue(label: String(localized: "Mesafe"), value: dist.0, unit: dist.1, icon: "route")
            }
        }
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
}

/// One big flight value tile.
struct FlightValue: View {
    let label: String
    let value: String
    let unit: String
    var icon: String
    var tint: Color? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(label, icon: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint ?? AeroTokens.textSecondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(tint ?? AeroTokens.textPrimary)
                    .contentTransition(.numericText())
                    .lineLimit(1).minimumScaleFactor(0.5)
                Text(unit).font(.subheadline.weight(.semibold)).foregroundStyle(AeroTokens.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AeroTokens.Space.s4)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
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
                    Label("Uçuş kaydedildi", icon: "checkmark.circle.fill")
                        .font(.title2.bold()).foregroundStyle(AeroTokens.success)
                    if let name = f?.eventName { Text(name).foregroundStyle(AeroTokens.textSecondary) }
                    if f?.isSimulated == true { SimBadge() }
                }
            }
            Section {
                if let f, let eventId = f.eventId?.uuidString.lowercased(), model.activeRetrieval(eventId: eventId) == nil {
                    Button {
                        model.retrieveRequest = RetrieveContext(eventId: eventId, eventName: f.eventName, flightId: f.id)
                    } label: { Label("Retrieve iste", icon: "car.fill") }
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
