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
        return ZStack(alignment: .top) {
            map(r).ignoresSafeArea()
            HStack {
                MapCircleButton(systemImage: "chevron.down", label: "Küçült (talep sürer)") { model.overlay = nil }
                    .accessibilityIdentifier("retrieval.minimize")
                Spacer()
                MapCircleButton(systemImage: "location.fill", label: "Konumuma git") { camera = .userLocation(fallback: camera) }
            }
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.top, AeroTokens.Space.s2)
            panel(r, stage: stage)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .toolbar(.hidden, for: .navigationBar)
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

    /// Ink panel: who is coming, the steps, the one action.
    private func panel(_ r: LocalRetrieval, stage: RetrievalStage) -> some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
            Capsule().fill(AeroTokens.textMuted.opacity(0.6)).frame(width: 44, height: 5)
                .frame(maxWidth: .infinity).accessibilityHidden(true)
            HStack(alignment: .firstTextBaseline) {
                Text(r.eventName ?? String(localized: "Retrieve")).font(.caption.weight(.semibold))
                    .foregroundStyle(AeroTokens.textSecondary).textCase(.uppercase)
                Spacer()
                Label(stage.shortTitle, systemImage: stage.systemImage)
                    .font(.caption.weight(.semibold)).foregroundStyle(stage.tone.color)
                    .accessibilityIdentifier("retrieval.stage")
                    .accessibilityValue(Text(Self.stageKey(stage)))
            }
            retrieverCard(stage)
            deliveryBanner(r)
            RetrievalLadder(stage: stage, server: server)
            if stage.sharesPilotPosition || model.sharing.isSharing { SharingStatusRow() }
            if !r.note.isEmpty {
                Label(r.note, systemImage: "text.bubble").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            }
            actions(r)
            Text("Retfast bir acil durum servisi değildir. Acil bir durumda 112'yi ara.")
                .font(.caption2).foregroundStyle(AeroTokens.textMuted)
        }
        .padding(.horizontal, AeroTokens.Space.s4)
        .padding(.top, AeroTokens.Space.s3)
        .padding(.bottom, AeroTokens.Space.s4)
        .background(AeroTokens.background, in: UnevenRoundedRectangle(topLeadingRadius: AeroTokens.Radius.xl, topTrailingRadius: AeroTokens.Radius.xl, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 16, y: -2)
        .environment(\.colorScheme, .dark)
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
        .mapControls { MapCompass() }
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
            HStack(spacing: AeroTokens.Space.s3) {
                Avatar(name: retriever.fullName, size: 52)
                VStack(alignment: .leading, spacing: 2) {
                    Text(retriever.fullName ?? String(localized: "Retriever")).font(.headline)
                    if let rp = server?.retrieverPosition {
                        let c = r.map(myCoordinate) ?? CLLocationCoordinate2D(latitude: rp.lat, longitude: rp.lon)
                        let me = (c.latitude, c.longitude)
                        TimelineView(.periodic(from: .now, by: 10)) { ctx in
                            Text("\(Fmt.distanceText(Fmt.meters((rp.lat, rp.lon), me))) uzakta" + (rp.t.map { " · \(Fmt.age(max(0, ctx.date.timeIntervalSince($0)))) önce" } ?? ""))
                                .font(.subheadline.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary)
                        }
                    } else {
                        Text("Retriever yolda").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                    }
                }
                Spacer()
                if let tel = AppleMaps.telURL(retriever.phone) {
                    RoundIconButton(systemImage: "phone.fill", label: "Retriever'ı ara", tint: AeroTokens.success) { openURL(tel) }
                        .accessibilityIdentifier("retrieval.call")
                }
            }
            .padding(AeroTokens.Space.s3)
            .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        } else if stage == .requested || stage == .sending || stage == .savedLocally {
            HStack(spacing: AeroTokens.Space.s3) {
                ProgressView().frame(width: 52, height: 52)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Retriever aranıyor").font(.headline)
                    Text("Bir retriever kabul edince adını ve konumunu göreceksin.")
                        .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
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
            Button { confirmCancel = true } label: {
                Label("Kendim döndüm, iptal et", systemImage: "figure.walk")
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
        let raw: [(String, Date?)] = [
            (String(localized: "Talep iletildi"), server?.requestedAt),
            (String(localized: "Retriever kabul etti"), server?.acceptedAt),
            (String(localized: "Alındın"), server?.pickedUpAt),
            (String(localized: "Teslim edildin"), server?.deliveredAt),
        ]
        VStack(alignment: .leading, spacing: 0) {
            StepTimeline(steps: raw.enumerated().map { i, s in
                StepTimeline.Step(id: i, title: s.0, time: s.1, done: i <= done, current: i == done + 1 && !stage.isFinished)
            })
            if stage == .cancelled { Label("Talep iptal edildi", systemImage: "xmark.circle").font(.subheadline) }
        }
    }
}
