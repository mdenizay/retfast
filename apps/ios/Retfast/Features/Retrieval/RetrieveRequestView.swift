import MapKit
import RetfastCore
import SwiftUI

/// "Retrieve iste": opened right after a flight ends. Pickup = current position
/// (accuracy shown) + optional quick note. Saved on the phone first, then sent
/// (outbox with retries). "Retrieve istemiyorum" closes it.
struct RetrieveRequestView: View {
    @Environment(AppModel.self) private var model
    let context: RetrieveContext
    @State private var note = ""
    @State private var picked: Set<Int> = []
    @State private var locator = OneShotLocator()
    @State private var busy = false
    @State private var error: String?
    @FocusState private var noteFocused: Bool

    static let chips: [String] = [
        String(localized: "Yol kenarındayım"),
        String(localized: "Kanat toplandı"),
        String(localized: "Yürüyorum"),
        String(localized: "Yaralı değilim"),
    ]

    /// Best available position: recent flight/sharing fix, else a quick fix.
    private var pickup: SharedPosition? {
        if let p = model.recentFix(maxAge: 120) { return p }
        if let f = locator.fix {
            return SharedPosition(lat: f.latitude, lon: f.longitude, gpsAltM: f.verticalAccuracy > 0 ? f.altitude : nil,
                                  hAccM: f.horizontalAccuracy, t: f.timestamp)
        }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Uçuş kaydedildi").font(.subheadline.weight(.semibold)).foregroundStyle(AeroTokens.success)
                        Text("Retrieve iste").font(.largeTitle.bold()).foregroundStyle(AeroTokens.textPrimary)
                        Text("Retriever'lar bulunduğun yeri ve notunu görür.")
                            .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                    }
                    pickupCard
                    noteSection
                    if let error { WarningRow(text: error, tone: .error) }
                }
                .padding(AeroTokens.Space.s4)
            }
            .scrollDismissesKeyboard(.interactively)

            VStack(spacing: AeroTokens.Space.s2) {
                Button {
                    Task { await send() }
                } label: {
                    if busy { ProgressView().tint(AeroTokens.onPrimary) } else { Label("Retrieve iste", icon: "car.fill") }
                }
                .buttonStyle(.aeroPrimaryLarge)
                .disabled(busy || pickup == nil)
                .accessibilityIdentifier("retrieve.send")
                Button("Retrieve istemiyorum") { model.dismissRetrieveRequest() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AeroTokens.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .accessibilityIdentifier("retrieve.skip")
            }
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.top, AeroTokens.Space.s2)
            .background(AeroTokens.background)
        }
        .aeroBackground()
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { if model.recentFix(maxAge: 120) == nil { locator.request() } }
        .onDisappear { locator.stop() }
    }

    private var pickupCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                if let p = pickup {
                    Map(initialPosition: .camera(MapCamera(centerCoordinate: p.coordinate, distance: 1200))) {
                        MapCircle(center: p.coordinate, radius: max(p.hAccM ?? 0, 5))
                            .foregroundStyle(AeroTokens.primary.opacity(0.15))
                            .stroke(AeroTokens.primary, lineWidth: 1)
                        Annotation(String(localized: "Alınma noktası"), coordinate: p.coordinate) {
                            RetrievalPin(status: .requested)
                        }
                    }
                    .allowsHitTesting(false)
                } else {
                    AeroTokens.surfaceElevated
                    VStack(spacing: AeroTokens.Space.s2) {
                        if locator.failed {
                            Image(icon: "location.slash").font(.title2)
                            Text("Konum alınamadı").font(.subheadline.weight(.semibold))
                            Button("Tekrar dene") { locator.request() }.font(.subheadline.weight(.semibold))
                        } else {
                            ProgressView()
                            Text("Konum alınıyor…").font(.subheadline)
                        }
                    }
                    .foregroundStyle(AeroTokens.textSecondary)
                }
            }
            .frame(height: 190)

            HStack(spacing: AeroTokens.Space.s3) {
                Image(icon: "mappin.and.ellipse").foregroundStyle(AeroTokens.primary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(pickup.map { Fmt.coordinate($0.lat, $0.lon) } ?? Fmt.dash)
                        .font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(AeroTokens.textPrimary)
                    Text(pickup.map { String(localized: "Doğruluk \(Fmt.accuracy($0.hAccM))") } ?? String(localized: "Şu anki konumun"))
                        .font(.caption).foregroundStyle(((pickup?.hAccM ?? 0) > 50) ? AeroTokens.warning : AeroTokens.textSecondary)
                }
                Spacer()
                if locator.refining { ProgressView().controlSize(.small) }
                else {
                    Button { locator.request() } label: { Image(icon: "arrow.clockwise") }
                        .accessibilityLabel(Text("Konumu yenile"))
                }
            }
            .padding(AeroTokens.Space.s4)
        }
        .background(AeroTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
    }

    private var noteSection: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
            Text("Not ekle").font(.headline).foregroundStyle(AeroTokens.textPrimary)
            FlowChips(items: Self.chips, selected: picked) { i in toggle(i) }
            TextField("Retriever'a not (isteğe bağlı)", text: $note, axis: .vertical)
                .lineLimit(1...4)
                .focused($noteFocused)
                .padding(AeroTokens.Space.s3)
                .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous))
                .accessibilityIdentifier("retrieve.note")
        }
    }

    private func toggle(_ i: Int) {
        Haptics.tick()
        if picked.contains(i) { picked.remove(i) } else { picked.insert(i) }
    }

    private var fullNote: String {
        let chips = picked.sorted().map { Self.chips[$0] }
        let typed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return (chips + (typed.isEmpty ? [] : [typed])).joined(separator: ", ")
    }

    private func send() async {
        guard let pickup else { return }
        busy = true; defer { busy = false }
        if model.session.isActive { model.endFlight() }
        do {
            try await model.requestRetrieve(context, pickup: pickup, note: fullNote)
        } catch {
            self.error = String(localized: "Talep telefona kaydedilemedi: \(String(describing: error))")
        }
    }
}

/// Wrapping capsule chips (multi-select).
struct FlowChips: View {
    let items: [String]
    let selected: Set<Int>
    let onTap: (Int) -> Void

    var body: some View {
        FlowLayout(spacing: AeroTokens.Space.s2) {
            ForEach(items.indices, id: \.self) { i in
                let on = selected.contains(i)
                Button { onTap(i) } label: {
                    HStack(spacing: 4) {
                        if on { Image(icon: "checkmark").font(.caption.weight(.bold)) }
                        Text(items[i])
                    }
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .foregroundStyle(on ? AeroTokens.onPrimary : AeroTokens.textPrimary)
                    .background(on ? AeroTokens.primary : AeroTokens.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(on ? .clear : AeroTokens.border))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("retrieve.chip.\(i)")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

/// Minimal wrapping layout.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height); maxX = max(maxX, x - spacing)
        }
        return CGSize(width: min(maxX, width), height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}
