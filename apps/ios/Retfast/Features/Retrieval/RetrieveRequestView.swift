import MapKit
import RetfastCore
import SwiftUI

/// "Retrieve iste": pickup = current position (accuracy shown) + optional note.
/// Saved on the phone first, then sent (outbox with retries).
struct RetrieveRequestView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let context: RetrieveContext
    @State private var note = ""
    @State private var locator = OneShotLocator()
    @State private var busy = false
    @State private var error: String?

    static let chips: [String] = [
        String(localized: "Yol kenarındayım"),
        String(localized: "Kanat toplandı"),
        String(localized: "Yürüyorum"),
    ]

    /// Best available position: recent flight/sharing fix, else a one-shot fix.
    private var pickup: SharedPosition? {
        if let p = model.recentFix(maxAge: 120) { return p }
        if let f = locator.fix {
            return SharedPosition(lat: f.latitude, lon: f.longitude, gpsAltM: f.verticalAccuracy > 0 ? f.altitude : nil,
                                  hAccM: f.horizontalAccuracy, t: f.timestamp)
        }
        return nil
    }

    var body: some View {
        Form {
            Section {
                if let p = pickup {
                    Map(initialPosition: .camera(MapCamera(centerCoordinate: p.coordinate, distance: 1500))) {
                        MapCircle(center: p.coordinate, radius: max(p.hAccM ?? 0, 5))
                            .foregroundStyle(AeroTokens.primary.opacity(0.15))
                            .stroke(AeroTokens.primary, lineWidth: 1)
                        Annotation(String(localized: "Alınma noktası"), coordinate: p.coordinate) {
                            RetrievalPin(status: .requested)
                        }
                    }
                    .frame(height: 180)
                    .listRowInsets(EdgeInsets())
                    KeyValueRow(key: String(localized: "Konum"), value: Fmt.coordinate(p.lat, p.lon), mono: true)
                    KeyValueRow(key: String(localized: "Doğruluk"), value: Fmt.accuracy(p.hAccM))
                    TimelineView(.periodic(from: .now, by: 5)) { ctx in
                        KeyValueRow(key: String(localized: "Konum zamanı"), value: p.t.map { "\(Fmt.time($0)) (\(Fmt.age(max(0, ctx.date.timeIntervalSince($0)))) önce)" } ?? Fmt.dash)
                    }
                    if (p.hAccM ?? 0) > 50 {
                        WarningRow(text: String(localized: "Konum doğruluğu düşük. Mümkünse açık alanda birkaç saniye bekleyip yenile."))
                    }
                } else {
                    Label(locator.failed ? "Konum alınamadı. Konum iznini ve gökyüzü görüşünü kontrol et." : "Konum alınıyor…",
                          systemImage: "location.magnifyingglass")
                }
                Button("Konumu yenile") { locator.request() }
            } header: {
                Text("Alınma noktası (şu anki konumun)")
            } footer: {
                Text("Retriever bekleme süresince güncel konumunu da görür (≈30 sn'de bir paylaşılır).")
            }

            Section("Not (isteğe bağlı)") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(Self.chips, id: \.self) { chip in
                            Button(chip) { append(chip) }
                                .buttonStyle(.bordered)
                                .accessibilityIdentifier("retrieve.chip.\(Self.chips.firstIndex(of: chip) ?? 0)")
                        }
                    }
                }
                TextField("ör. yol kenarındayım, kanat toplandı", text: $note, axis: .vertical)
                    .lineLimit(2...4)
                    .accessibilityIdentifier("retrieve.note")
            }

            if model.session.isActive {
                Section { WarningRow(text: String(localized: "Gönderince uçuş kaydı bitirilir."), tone: .info, systemImage: "stop.circle") }
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }

            Section {
                Button {
                    Task { await send() }
                } label: {
                    if busy { ProgressView() } else { Label("Retrieve iste", systemImage: "car.fill") }
                }
                .buttonStyle(.aeroPrimaryLarge)
                .disabled(busy || pickup == nil)
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                .accessibilityIdentifier("retrieve.send")
            } footer: {
                Text("Talep önce telefona kaydedilir; bağlantı yoksa bağlantı gelince otomatik gönderilir. Retfast bir acil durum servisi değildir: acil durumda 112'yi ara.")
            }
        }
        .navigationTitle(context.eventName ?? String(localized: "Retrieve iste"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } } }
        .onAppear { if model.recentFix(maxAge: 120) == nil { locator.request() } }
    }

    private func append(_ chip: String) {
        Haptics.tick()
        if note.localizedCaseInsensitiveContains(chip) { return }
        note = note.isEmpty ? chip : "\(note), \(chip.lowercased())"
    }

    private func send() async {
        guard let pickup else { return }
        busy = true; defer { busy = false }
        if model.session.isActive { model.endFlight() }
        do {
            try await model.requestRetrieve(context, pickup: pickup, note: note)
        } catch {
            self.error = String(localized: "Talep telefona kaydedilemedi: \(String(describing: error))")
        }
    }
}
