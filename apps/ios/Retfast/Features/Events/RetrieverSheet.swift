import CoreLocation
import RetfastCore
import SwiftUI

/// Retriever bottom sheet: duty toggle, my active pickups, open requests.
struct RetrieverSheet: View {
    @Environment(AppModel.self) private var model
    let event: Event
    @Bindable var board: RetrieverBoard
    let live: EventLiveModel?
    @State private var dutyError: String?
    @State private var dutyBusy = false

    private var me: (lat: Double, lon: Double)? {
        model.sharing.lastFix.map { ($0.latitude, $0.longitude) } ?? model.recentFix(maxAge: 600).map { ($0.lat, $0.lon) }
    }

    enum Tab: Hashable { case requests, pickups }
    @State private var tab: Tab = .requests

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            dutyCard
            if let notice = board.notice { noticeCard(notice) }
            CapsuleSegment(selection: $tab, options: [
                (.requests, String(localized: "Talepler · \(board.openRequests.count)")),
                (.pickups, String(localized: "Alımlarım · \(board.myPickups.count)")),
            ])
            .accessibilityIdentifier("retriever.tabs")
            switch tab {
            case .requests:
                if board.openRequests.isEmpty {
                    emptyState(String(localized: "Bekleyen pilot yok"),
                               String(localized: "Yeni retrieve talepleri burada ve haritada görünür."), "hand.raised")
                }
                ForEach(board.openRequests) { r in OpenRequestCard(retrieval: r, board: board, me: me) }
            case .pickups:
                if board.myPickups.isEmpty {
                    emptyState(String(localized: "Aktif alımın yok"),
                               String(localized: "Bir talebi kabul ettiğinde pilot burada görünür."), "car")
                }
                ForEach(board.myPickups) { r in PickupCard(retrieval: r, board: board, me: me) }
            }
            if let e = board.refreshError {
                WarningRow(text: String(localized: "Liste yenilenemedi (\(e)). Tekrar denenecek."))
            }
            if let t = board.lastRefresh {
                Text("Son güncelleme \(Fmt.time(t))").font(.caption2).foregroundStyle(AeroTokens.textMuted)
            }
        }
        .task { await board.refresh() }
        .onChange(of: board.myPickups.count) { old, new in if new > old { tab = .pickups } }
        .onAppear { if !board.myPickups.isEmpty { tab = .pickups } }
    }

    private func emptyState(_ title: String, _ text: String, _ icon: String) -> some View {
        VStack(spacing: AeroTokens.Space.s2) {
            Image(systemName: icon).font(.title).foregroundStyle(AeroTokens.textMuted)
            Text(title).font(.headline)
            Text(text).font(.subheadline).foregroundStyle(AeroTokens.textSecondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AeroTokens.Space.s6)
    }

    private var dutyCard: some View {
        AeroCard {
            Toggle(isOn: Binding(get: { board.onDuty }, set: { on in
                Task {
                    dutyBusy = true; defer { dutyBusy = false }
                    do { try await board.setDuty(on); dutyError = nil; Haptics.tick() }
                    catch { dutyError = ErrorText.message(error) }
                }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Görevdeyim").font(.headline)
                    Text(board.onDuty ? "Organizatörler seni müsait görür; konumun ≈15 sn'de bir paylaşılır."
                                      : "Görevde değilken konumun yalnızca kabul ettiğin alım sürerken paylaşılır.")
                        .font(.caption).foregroundStyle(AeroTokens.textSecondary)
                }
            }
            .disabled(dutyBusy)
            .accessibilityIdentifier("retriever.duty")
            SharingStatusRow()
            if let dutyError { WarningRow(text: dutyError, tone: .error) }
        }
    }

    private func noticeCard(_ notice: RetrieverBoard.Notice) -> some View {
        AeroCard {
            switch notice {
            case .alreadyTaken(let name):
                WarningRow(text: String(localized: "\(name ?? String(localized: "Bu pilot")) için talebi başka bir retriever senden önce kabul etti. Liste güncellendi."),
                           tone: .info, systemImage: "person.2")
            case .failed(let code):
                WarningRow(text: String(localized: "İşlem tamamlanamadı (\(code)). Durum sunucudan yeniden okundu."), tone: .error)
            }
            Button("Tamam") { board.clearNotice() }.font(.subheadline.weight(.semibold))
        }
        .accessibilityIdentifier("retriever.notice")
    }
}

/// "Konum paylaşılıyor · son gönderim 12 sn önce" — honest sharing state.
struct SharingStatusRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { ctx in
            let s = model.sharing
            if s.isSharing {
                VStack(alignment: .leading, spacing: 2) {
                    Label {
                        Text(s.lastSentAt.map { String(localized: "Konum paylaşılıyor · son gönderim \(Fmt.age(max(0, ctx.date.timeIntervalSince($0)))) önce") }
                             ?? String(localized: "Konum paylaşımı başladı · ilk konum bekleniyor"))
                    } icon: { Image(systemName: "location.fill.viewfinder").foregroundStyle(AeroTokens.trackingActive) }
                    if let e = s.lastError {
                        Text("Son gönderim başarısız: \(e). Tekrar denenecek.").font(.caption).foregroundStyle(AeroTokens.warning)
                    }
                    if !s.authorization.canRecord {
                        Text("Konum izni yok: paylaşım yapılamıyor.").font(.caption).foregroundStyle(AeroTokens.error)
                    }
                }
                .font(.subheadline)
            } else {
                Label("Konum paylaşılmıyor", systemImage: "location.slash").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            }
        }
        .accessibilityIdentifier("sharing.status")
    }
}

/// Distance and waiting time helpers for retriever cards.
enum RetrievalInfo {
    static func distance(_ r: Retrieval, from me: (lat: Double, lon: Double)?) -> String? {
        guard let me, let p = r.latestPilotPosition else { return nil }
        return Fmt.distanceText(Fmt.meters(me, (p.lat, p.lon)))
    }

    static func positionAge(_ r: Retrieval, now: Date = Date()) -> String? {
        guard let t = r.latestPilotPosition?.t else { return nil }
        return Fmt.age(max(0, now.timeIntervalSince(t)))
    }
}

struct OpenRequestCard: View {
    let retrieval: Retrieval
    let board: RetrieverBoard
    let me: (lat: Double, lon: Double)?

    var body: some View {
        AeroCard(padding: AeroTokens.Space.s4) {
            HStack(spacing: AeroTokens.Space.s3) {
                Avatar(name: retrieval.pilot?.fullName, size: 48, tint: AeroTokens.primary)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(retrieval.pilot?.fullName ?? String(localized: "Pilot")).font(.headline)
                        if retrieval.isSimulated == true { SimBadge() }
                    }
                    TimelineView(.periodic(from: .now, by: 30)) { ctx in
                        HStack(spacing: 6) {
                            Text("\(Fmt.age(max(0, ctx.date.timeIntervalSince(retrieval.requestedAt ?? ctx.date)))) bekliyor")
                            if let d = RetrievalInfo.distance(retrieval, from: me) { Text("· \(d)") }
                        }
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(AeroTokens.textSecondary)
                    }
                }
                Spacer()
            }
            if let note = retrieval.note, !note.isEmpty {
                Label(note, systemImage: "text.bubble").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            }
            Button {
                Task {
                    let outcome = await board.accept(retrieval.id)
                    if outcome == .accepted { Haptics.success() } else { Haptics.attention() }
                }
            } label: {
                if board.busy.contains(retrieval.id) { ProgressView() } else { Label("Kabul et", systemImage: "checkmark") }
            }
            .buttonStyle(.aeroPrimary)
            .disabled(board.busy.contains(retrieval.id))
            .accessibilityIdentifier("retriever.accept.\(retrieval.pilot?.fullName ?? retrieval.id)")
        }
    }
}

struct PickupCard: View {
    @Environment(\.openURL) private var openURL
    let retrieval: Retrieval
    let board: RetrieverBoard
    let me: (lat: Double, lon: Double)?
    @State private var confirmRelease = false
    @State private var showDelivered = false
    @State private var deliveryNote = ""

    var body: some View {
        let status = retrieval.retrievalStatus ?? .accepted
        AeroCard(padding: AeroTokens.Space.s4) {
            HStack(spacing: AeroTokens.Space.s3) {
                Avatar(name: retrieval.pilot?.fullName, size: 48, tint: AeroTokens.primary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(retrieval.pilot?.fullName ?? String(localized: "Pilot")).font(.headline)
                    Label(status.title, systemImage: status.systemImage)
                        .font(.subheadline).foregroundStyle(status.tone.color)
                }
                Spacer()
                if let tel = AppleMaps.telURL(retrieval.pilot?.phone) {
                    RoundIconButton(systemImage: "phone.fill", label: "Ara", tint: AeroTokens.success) { openURL(tel) }
                }
                if let p = retrieval.latestPilotPosition, let url = AppleMaps.directionsURL(to: p.coordinate, name: retrieval.pilot?.fullName ?? "Pilot") {
                    RoundIconButton(systemImage: "arrow.triangle.turn.up.right.diamond.fill", label: "Navigasyon", tint: AeroTokens.secondary) { openURL(url) }
                }
            }
            HStack(spacing: AeroTokens.Space.s2) {
                if let d = RetrievalInfo.distance(retrieval, from: me) {
                    Label(d, systemImage: "location").font(.subheadline.monospacedDigit())
                }
                TimelineView(.periodic(from: .now, by: 15)) { ctx in
                    if let age = RetrievalInfo.positionAge(retrieval, now: ctx.date) {
                        Text("· konum \(age) önce · \(Fmt.accuracy(retrieval.latestPilotPosition?.hAccM))")
                            .font(.caption.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary)
                    }
                }
            }
            if let note = retrieval.note, !note.isEmpty { Label(note, systemImage: "text.bubble").font(.subheadline) }
            if AppleMaps.telURL(retrieval.pilot?.phone) == nil {
                Text("Pilot telefon numarası eklememiş.").font(.caption).foregroundStyle(AeroTokens.textSecondary)
            }
            if status == .accepted {
                Button { Task { if await board.markPickedUp(retrieval.id) { Haptics.success() } } } label: {
                    Label("Aldım", systemImage: "figure.seated.side")
                }
                .buttonStyle(.aeroPrimary)
                .disabled(board.busy.contains(retrieval.id))
                .accessibilityIdentifier("retriever.pickedUp")
                Button("Bırak (başka retriever alsın)", role: .destructive) { confirmRelease = true }
                    .font(.subheadline)
            } else if status == .pickedUp {
                Button { showDelivered = true } label: { Label("Teslim ettim", systemImage: "checkmark.circle.fill") }
                    .buttonStyle(.aeroPrimary)
                    .disabled(board.busy.contains(retrieval.id))
                    .accessibilityIdentifier("retriever.delivered")
            }
        }
        .confirmationDialog("Talebi bırak?", isPresented: $confirmRelease, titleVisibility: .visible) {
            Button("Bırak", role: .destructive) { Task { _ = await board.release(retrieval.id) } }
        } message: {
            Text("Talep yeniden açık taleplere düşer ve başka bir retriever kabul edebilir.")
        }
        .sheet(isPresented: $showDelivered) {
            NavigationStack {
                Form {
                    Section {
                        TextField("Not (isteğe bağlı), ör. kalkışa bırakıldı", text: $deliveryNote, axis: .vertical)
                    }
                    Section {
                        Button("Teslim edildi olarak işaretle") {
                            Task {
                                if await board.markDelivered(retrieval.id, note: deliveryNote.isEmpty ? nil : deliveryNote) { Haptics.success() }
                                showDelivered = false
                            }
                        }
                        .buttonStyle(.aeroPrimary)
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                        .accessibilityIdentifier("retriever.deliveredConfirm")
                    }
                }
                .navigationTitle("Teslim")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { showDelivered = false } } }
            }
            .presentationDetents([.medium])
        }
    }
}
