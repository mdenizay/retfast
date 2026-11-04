import RetfastCore
import SwiftUI
import UIKit

/// Press-and-hold for 3 s, with visible progress and a haptic each second.
struct HoldToConfirmButton: View {
    let title: LocalizedStringKey
    var duration: Double = 3
    let action: () -> Void
    @State private var progress: Double = 0
    @State private var holding = false
    @State private var task: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: AeroTokens.Radius.xl, style: .continuous)
                .fill(AeroTokens.emergency)
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: AeroTokens.Radius.xl, style: .continuous)
                    .fill(Color.black.opacity(0.25))
                    .frame(width: geo.size.width * progress)
            }
            VStack(spacing: 4) {
                Text(title).font(.title2.weight(.heavy))
                Text(holding ? "Bırakmayın… \(Int(ceil(duration - progress * duration))) sn" : "Göndermek için 3 saniye basılı tutun")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            .foregroundStyle(AeroTokens.onEmergency)
            .padding()
        }
        .frame(minHeight: 120)
        .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.xl, style: .continuous))
        .scaleEffect(holding && !reduceMotion ? 0.98 : 1)
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: duration, maximumDistance: 40, perform: {}, onPressingChanged: { pressing in
            pressing ? begin() : cancel()
        })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityHint(Text("Acil durum çağrısı göndermek için iki kez dokunun ve onaylayın"))
        .accessibilityAction { action() } // VoiceOver: explicit action instead of a timed hold
        .accessibilityIdentifier("sos.hold")
    }

    private func begin() {
        holding = true
        progress = 0
        task?.cancel()
        task = Task { @MainActor in
            let steps = Int(duration * 20)
            for i in 1...steps {
                try? await Task.sleep(nanoseconds: 50_000_000)
                if Task.isCancelled { return }
                progress = Double(i) / Double(steps)
                if i % 20 == 0 { Haptics.tick() }
            }
            holding = false
            Haptics.sos()
            action()
            progress = 0
        }
    }

    private func cancel() {
        guard holding else { return }
        holding = false
        task?.cancel()
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { progress = 0 }
    }
}

struct SOSView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var locator = OneShotLocator()
    @State private var isTest = false
    @State private var message = ""
    @State private var error: String?
    @State private var confirmCancel = false

    private var recentlyRefused: LocalIncident? {
        model.incidents.values
            .filter { $0.deliveryState == .refused && Date().timeIntervalSince($0.createdAtDevice) < 600 }
            .max { $0.createdAtDevice < $1.createdAtDevice }
    }

    private var flightEvent: Event? { model.event(id: model.session.flight?.eventId) }
    private var testAllowed: Bool { flightEvent?.settings?.emergencyTesting == true }

    /// Best position we have: the recording engine's last fix, else a one-shot fix.
    private var position: (lat: Double, lon: Double, alt: Double?, acc: Double?, t: Date?)? {
        let v = model.session.values
        if model.session.isActive, let lat = v.latitude, let lon = v.longitude {
            return (lat, lon, v.gpsAltitude, v.horizontalAccuracy, v.lastFixAt)
        }
        if let f = locator.fix {
            return (f.latitude, f.longitude, f.verticalAccuracy > 0 ? f.altitude : nil, f.horizontalAccuracy, f.timestamp)
        }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                if let incident = model.activeIncident {
                    SOSStatusView(incident: incident, onCancel: { confirmCancel = true })
                } else {
                    if let refused = recentlyRefused {
                        SOSStatusView(incident: refused, onCancel: {})
                    }
                    composer
                }
                callEmergencyServices
                NavigationLink("Geçmiş acil durum çağrıları") { SOSHistoryView() }
                    .font(.subheadline)
            }
            .padding(AeroTokens.Space.s4)
        }
        .aeroBackground()
        .navigationTitle("Acil durum")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Kapat") { dismiss() } } }
        .onAppear { if !model.session.isActive { locator.request() } }
        .confirmationDialog("Acil durum çağrısını iptal et?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Çağrıyı iptal et", role: .destructive) {
                if let id = model.activeIncident?.id { Task { try? await model.emergency.cancel(id: id) } }
            }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("İptal, sunucuya iletilene kadar yeniden denenir. Gerçekten yardıma ihtiyacınız varsa iptal etmeyin.")
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
            AeroCard {
                Text("Bu çağrı Retfast kurtarma ekibine internet üzerinden iletilir. 112'yi veya yetkilileri otomatik aramaz.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AeroTokens.textPrimary)
                KeyValueRow(key: String(localized: "Konum"), value: Fmt.coordinate(position?.lat, position?.lon), mono: true)
                KeyValueRow(key: String(localized: "Doğruluk"), value: Fmt.accuracy(position?.acc), mono: true)
                KeyValueRow(key: String(localized: "Son GPS zamanı"), value: position?.t.map { "\(Fmt.time($0)) (\(Fmt.relative($0)))" } ?? Fmt.dash)
                KeyValueRow(key: String(localized: "Ağ"), value: model.networkStatus.isConnected ? String(localized: "Bağlı") : String(localized: "Bağlantı yok"))
                if !model.networkStatus.isConnected {
                    WarningRow(text: String(localized: "Bağlantı yok. Çağrı telefona kaydedilir ve bağlantı gelince otomatik gönderilir. Şu an kimseye ulaşmaz."), tone: .error)
                }
                if position == nil {
                    WarningRow(text: String(localized: "Konum henüz yok. Çağrı konumsuz gönderilir; sunucu son kaydedilen uçuş konumunuzu kullanabilir."))
                }
            }
            if testAllowed {
                Toggle(isOn: $isTest) {
                    HStack { TestBadge(); Text("Test çağrısı (gerçek acil durum değil)") }
                }
                .accessibilityIdentifier("sos.test")
            }
            TextField("Not (isteğe bağlı): yaralanma, ağaçta, vb.", text: $message, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
            if let error { WarningRow(text: error, tone: .error) }
            HoldToConfirmButton(title: isTest ? "TEST SOS GÖNDER" : "SOS GÖNDER") { trigger() }
        }
    }

    private var callEmergencyServices: some View {
        Button {
            if let url = URL(string: "tel://112") { openURL(url) }
        } label: {
            Label("112'yi ara", systemImage: "phone.fill")
        }
        .buttonStyle(.aeroSecondary)
        .accessibilityHint(Text("Telefon uygulamasını açar"))
    }

    private func trigger() {
        let p = position
        let pos = p.map { IncidentPosition(lat: $0.lat, lon: $0.lon, gpsAltM: $0.alt, hAccM: $0.acc, t: $0.t) }
        let flight = model.session.isActive ? model.session.flight : nil
        Task {
            do {
                _ = try await model.emergency.trigger(position: pos, flightId: flight?.id, eventId: flight?.eventId,
                                                      isTest: isTest && testAllowed, message: message)
                error = nil
            } catch {
                self.error = String(localized: "Çağrı telefona kaydedilemedi: \(String(describing: error))")
            }
        }
    }
}

/// The explicit delivery ladder. Wording never claims help is on the way
/// before a responder has acknowledged.
struct SOSStatusView: View {
    let incident: LocalIncident
    let onCancel: () -> Void
    @Environment(AppModel.self) private var model

    private struct Step: Identifiable {
        let id: SOSDeliveryState
        let title: LocalizedStringKey
        let detail: LocalizedStringKey
    }

    private let steps: [Step] = [
        Step(id: .createdLocally, title: "Telefona kaydedildi", detail: "Çağrı cihazınızda saklanıyor."),
        Step(id: .pendingTransmission, title: "Gönderiliyor", detail: "Sunucu henüz almadı. Bağlantı olduğunda otomatik yeniden denenir."),
        Step(id: .receivedByServer, title: "Sunucu aldı", detail: "Çağrı Retfast sunucusunda. Henüz bir görevli onaylamadı."),
        Step(id: .acknowledged, title: "Ekip onayladı", detail: "Bir kurtarma görevlisi çağrınızı gördü ve onayladı."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
            HStack {
                Text("Acil durum çağrısı").font(.title2.bold())
                if incident.isTest { TestBadge() }
            }
            AeroCard {
                ForEach(steps) { step in
                    let reached = incident.deliveryState.rank >= step.id.rank
                    let current = incident.deliveryState == step.id
                    HStack(alignment: .top, spacing: AeroTokens.Space.s3) {
                        Image(systemName: reached ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(reached ? AeroTokens.success : AeroTokens.textMuted)
                            .font(.title3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.title).font(.headline)
                                .foregroundStyle(reached ? AeroTokens.textPrimary : AeroTokens.textMuted)
                            if current || (step.id == .acknowledged && reached) {
                                Text(step.detail).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                            }
                            if step.id == .acknowledged, reached, let name = incident.acknowledgedByName {
                                Text("\(name) · \(Fmt.time(incident.acknowledgedAt))").font(.subheadline.weight(.semibold))
                            }
                            if step.id == .receivedByServer, reached, let at = incident.receivedAt {
                                Text("Alındı: \(Fmt.time(at))").font(.caption).foregroundStyle(AeroTokens.textSecondary)
                            }
                        }
                        Spacer()
                        if current && !reachedFinal { ProgressView() }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(reached ? Text("tamamlandı") : Text("bekliyor"))
                }
            }
            .accessibilityIdentifier("sos.ladder")

            AeroCard {
                KeyValueRow(key: String(localized: "Gönderilen konum"), value: Fmt.coordinate(incident.lat, incident.lon), mono: true)
                KeyValueRow(key: String(localized: "Doğruluk"), value: Fmt.accuracy(incident.hAcc), mono: true)
                KeyValueRow(key: String(localized: "GPS zamanı"), value: Fmt.time(incident.positionTime))
                KeyValueRow(key: String(localized: "Oluşturuldu"), value: Fmt.time(incident.createdAtDevice))
                KeyValueRow(key: String(localized: "Deneme"), value: "\(incident.attemptCount)")
                if let e = incident.lastError {
                    KeyValueRow(key: String(localized: "Son hata"), value: e == "offline" ? String(localized: "bağlantı yok") : e)
                }
                KeyValueRow(key: String(localized: "Ağ"), value: model.networkStatus.isConnected ? String(localized: "Bağlı") : String(localized: "Bağlantı yok"))
            }

            if incident.deliveryState == .refused {
                WarningRow(text: String(localized: "Sunucu bu çağrıyı reddetti (\(incident.lastError ?? "?")). Çağrı iletilmedi. 112'yi arayın."), tone: .emergency)
            } else if incident.deliveryState.rank < SOSDeliveryState.acknowledged.rank {
                WarningRow(text: String(localized: "Henüz kimse çağrınızı onaylamadı. Mümkünse 112'yi arayın ve güvende kalın."), tone: .emergency)
            }
            if incident.isTerminal {
                EmptyView()
            } else if incident.cancelRequested {
                StatusPill(String(localized: "İptal isteniyor…"), systemImage: "xmark.circle", tone: .warning)
            } else {
                Button("Çağrıyı iptal et", role: .destructive, action: onCancel)
                    .buttonStyle(.aeroSecondary)
                    .accessibilityIdentifier("sos.cancel")
            }
        }
    }

    private var reachedFinal: Bool { incident.deliveryState.rank >= SOSDeliveryState.acknowledged.rank }
}

struct SOSHistoryView: View {
    @Environment(AppModel.self) private var model
    @State private var items: [LocalIncident] = []

    var body: some View {
        List(items) { i in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(Fmt.dateTime(i.createdAtDevice)).font(.headline)
                    if i.isTest { TestBadge() }
                    Spacer()
                    StatusPill(stateTitle(i.deliveryState), systemImage: i.isTerminal ? "checkmark.circle" : "clock", tone: i.isTerminal ? .neutral : .warning)
                }
                Text(Fmt.coordinate(i.lat, i.lon)).font(.caption.monospaced()).foregroundStyle(AeroTokens.textSecondary)
            }
        }
        .overlay { if items.isEmpty { ContentUnavailableView("Çağrı yok", systemImage: "sos", description: Text("Bu cihazdan gönderilmiş acil durum çağrısı yok.")) } }
        .navigationTitle("Acil durum geçmişi")
        .task(id: model.incidents.count) { items = (try? model.store.incidents(limit: 100)) ?? [] }
    }

    private func stateTitle(_ s: SOSDeliveryState) -> String {
        switch s {
        case .createdLocally: String(localized: "Telefonda")
        case .pendingTransmission: String(localized: "Gönderiliyor")
        case .receivedByServer: String(localized: "Sunucu aldı")
        case .acknowledged: String(localized: "Onaylandı")
        case .resolved: String(localized: "Çözüldü")
        case .cancelled: String(localized: "İptal edildi")
        case .refused: String(localized: "Sunucu reddetti")
        }
    }
}
