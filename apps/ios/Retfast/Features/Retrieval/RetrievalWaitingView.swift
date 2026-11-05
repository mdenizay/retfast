import MapKit
import RetfastCore
import SwiftUI

/// Pilot's waiting screen: Requested → Accepted → Picked up → Delivered,
/// my position + the retriever's live position, call button, "Kendim döndüm".
/// Logistics language only; nothing implies an emergency response.
struct RetrievalWaitingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let retrievalId: UUID
    @State private var live: EventLiveModel?
    @State private var confirmCancel = false
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)

    private var r: LocalRetrieval? { model.localRetrievals[retrievalId] }

    /// Server copy, overlaid with fresher realtime data for this retrieval.
    private var server: Retrieval? {
        var s = r?.server
        if let liveCopy = live?.retrievals.first(where: { $0.id.lowercased() == r?.wireId }) {
            if s == nil || liveCopy.status == s?.status { s = liveCopy }
            else if let pos = liveCopy.retrieverPosition { s?.retrieverPosition = pos }
        }
        return s
    }

    var body: some View {
        NavigationStack {
            if let r {
                content(r)
            } else {
                ContentUnavailableView("Talep bulunamadı", systemImage: "questionmark")
                    .toolbar { closeButton }
            }
        }
    }

    @ToolbarContentBuilder private var closeButton: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button { model.overlay = nil } label: { Image(systemName: "chevron.down") }
                .accessibilityLabel(Text("Küçült (talep sürer)"))
                .accessibilityIdentifier("retrieval.minimize")
        }
    }

    private func content(_ r: LocalRetrieval) -> some View {
        let stage = r.stage
        return ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
                map(r)
                    .frame(height: 260)
                    .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
                StatusPill(stage.shortTitle, systemImage: stage.systemImage, tone: stage.tone)
                    .accessibilityIdentifier("retrieval.stage")
                    .accessibilityValue(Text(Self.stageKey(stage)))
                deliveryBanner(r)
                RetrievalLadder(stage: stage, server: server)
                retrieverCard(stage)
                if stage.sharesPilotPosition || model.sharing.isSharing { AeroCard { SharingStatusRow() } }
                if !r.note.isEmpty {
                    AeroCard { Label(r.note, systemImage: "text.bubble").font(.subheadline) }
                }
                actions(r)
                Text("Retfast bir acil durum servisi değildir. Acil bir durumda 112'yi ara.")
                    .font(.caption).foregroundStyle(AeroTokens.textSecondary)
            }
            .padding(AeroTokens.Space.s4)
        }
        .aeroBackground()
        .navigationTitle(r.eventName ?? String(localized: "Retrieve"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { closeButton }
        .task(id: r.eventId) {
            let l = EventLiveModel(model: model, eventId: r.eventId, subscribePositions: false)
            let manager = model.retrievals
            l.onRetrieval = { s in Task { await manager.apply(s) } }
            live = l
            await l.start()
        }
        .onDisappear { live?.stop() }
        .onChange(of: stage) { old, new in
            if new == .accepted || new == .pickedUp || new == .delivered { Haptics.success() }
        }
        .confirmationDialog("Kendin mi döndün?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Evet, talebi iptal et", role: .destructive) { Task { await model.cancelRetrieval(retrievalId, reason: "kendim döndüm") } }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Retriever'a artık gerek olmadığı bildirilir ve konum paylaşımın durur.")
        }
    }

    static func stageKey(_ s: RetrievalStage) -> String {
        switch s {
        case .savedLocally: "saved_locally"
        case .sending: "sending"
        case .requested: "requested"
        case .accepted: "accepted"
        case .pickedUp: "picked_up"
        case .delivered: "delivered"
        case .cancelling: "cancelling"
        case .cancelled: "cancelled"
        case .refused: "refused"
        case .merged: "merged"
        }
    }

    private func map(_ r: LocalRetrieval) -> some View {
        Map(position: $camera) {
            UserAnnotation()
            Annotation(String(localized: "Alınma noktası"), coordinate: r.pickup.coordinate) { RetrievalPin(status: .requested) }
            if let rp = server?.retrieverPosition, r.stage == .accepted || r.stage == .pickedUp {
                MapPolyline(coordinates: [rp.coordinate, myCoordinate(r)])
                    .stroke(AeroTokens.secondary, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                Annotation(server?.retriever?.fullName ?? String(localized: "Retriever"), coordinate: rp.coordinate) { RetrieverPin() }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls { MapUserLocationButton(); MapCompass() }
    }

    private func myCoordinate(_ r: LocalRetrieval) -> CLLocationCoordinate2D {
        if let f = model.sharing.lastFix { return CLLocationCoordinate2D(latitude: f.latitude, longitude: f.longitude) }
        return r.pickup.coordinate
    }

    @ViewBuilder private func deliveryBanner(_ r: LocalRetrieval) -> some View {
        switch r.stage {
        case .savedLocally, .sending:
            AeroCard {
                WarningRow(text: r.attemptCount == 0
                           ? String(localized: "Talep telefona kaydedildi. Gönderiliyor…")
                           : String(localized: "Talep telefonda kayıtlı, henüz sunucuya ulaşmadı (\(r.attemptCount). deneme\(r.lastError.map { " · \($0)" } ?? "")). Bağlantı gelince otomatik gönderilir."),
                           tone: .warning, systemImage: "iphone.and.arrow.forward")
            }
        case .refused:
            AeroCard {
                WarningRow(text: String(localized: "Sunucu talebi kabul etmedi (\(r.lastError ?? "?")). Etkinlikte pilot rolün olmayabilir; organizatörle iletişime geç."), tone: .error)
            }
        case .cancelling:
            AeroCard { WarningRow(text: String(localized: "İptal sunucuya iletiliyor…"), tone: .warning, systemImage: "arrow.up.circle") }
        default:
            if let e = r.lastError, r.outbox == .sent {
                Text("Son güncelleme alınamadı (\(e)); tekrar deneniyor.").font(.caption).foregroundStyle(AeroTokens.warning)
            }
        }
    }

    @ViewBuilder private func retrieverCard(_ stage: RetrievalStage) -> some View {
        if let retriever = server?.retriever, stage == .accepted || stage == .pickedUp || stage == .delivered {
            AeroCard {
                HStack {
                    Image(systemName: "car.fill").foregroundStyle(AeroTokens.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(retriever.fullName ?? String(localized: "Retriever")).font(.headline)
                        if let rp = server?.retrieverPosition {
                            let me = model.sharing.lastFix.map { ($0.latitude, $0.longitude) } ?? (r?.pickupLat ?? rp.lat, r?.pickupLon ?? rp.lon)
                            Text("Uzaklık (kuş uçuşu): \(Fmt.distanceText(Fmt.meters((rp.lat, rp.lon), me)))")
                                .font(.subheadline.monospacedDigit())
                            if let t = rp.t {
                                TimelineView(.periodic(from: .now, by: 10)) { ctx in
                                    Text("Retriever konumu \(Fmt.age(max(0, ctx.date.timeIntervalSince(t)))) önce")
                                        .font(.caption).foregroundStyle(AeroTokens.textSecondary)
                                }
                            }
                        }
                    }
                    Spacer()
                }
                if let tel = AppleMaps.telURL(retriever.phone) {
                    Button { openURL(tel) } label: { Label("Retriever'ı ara", systemImage: "phone.fill") }
                        .buttonStyle(.aeroPrimary)
                        .accessibilityIdentifier("retrieval.call")
                }
            }
        }
    }

    @ViewBuilder private func actions(_ r: LocalRetrieval) -> some View {
        if r.stage.isFinished {
            Button("Kapat") { model.overlay = nil }
                .buttonStyle(.aeroPrimary)
                .accessibilityIdentifier("retrieval.close")
        } else if r.stage != .cancelling && r.stage != .pickedUp {
            Button(role: .destructive) { confirmCancel = true } label: {
                Label("Kendim döndüm", systemImage: "figure.walk")
            }
            .buttonStyle(.aeroSecondary)
            .accessibilityIdentifier("retrieval.cancel")
        }
    }
}

/// The four-step ladder. Steps are only marked done when the server said so.
struct RetrievalLadder: View {
    let stage: RetrievalStage
    let server: Retrieval?

    var body: some View {
        let done = stage.confirmedStep ?? -1
        let steps: [(String, String, Date?)] = [
            (String(localized: "Talep iletildi"), "paperplane", server?.requestedAt),
            (String(localized: "Retriever kabul etti"), "car", server?.acceptedAt),
            (String(localized: "Alındın"), "figure.seated.side", server?.pickedUpAt),
            (String(localized: "Teslim edildin"), "checkmark.circle", server?.deliveredAt),
        ]
        AeroCard {
            ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                HStack(spacing: AeroTokens.Space.s3) {
                    Image(systemName: i <= done ? "checkmark.circle.fill" : (i == done + 1 && !stage.isFinished ? "circle.dotted" : "circle"))
                        .foregroundStyle(i <= done ? AeroTokens.success : AeroTokens.textMuted)
                        .font(.title3)
                    Label(step.0, systemImage: step.1)
                        .font(.subheadline.weight(i == done ? .semibold : .regular))
                        .foregroundStyle(i <= done ? AeroTokens.textPrimary : AeroTokens.textSecondary)
                    Spacer()
                    if i <= done, let t = step.2 { Text(Fmt.time(t)).font(.caption.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(Text(i <= done ? "tamam" : "bekliyor"))
            }
            if stage == .cancelled { Label("Talep iptal edildi", systemImage: "xmark.circle").font(.subheadline) }
        }
    }
}
