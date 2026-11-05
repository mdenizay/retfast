import RetfastCore
import SwiftUI

/// Observer (and organizer-only) sheet: read-only overview of the live map.
struct ObserverSheet: View {
    let event: Event
    let live: EventLiveModel?

    var body: some View {
        let pilots = live?.pilots ?? []
        let open = live?.openRetrievals ?? []
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            HStack(spacing: AeroTokens.Space.s2) {
                counter(String(localized: "Canlı"), pilots.filter { $0.freshness == "live" }.count, "dot.radiowaves.left.and.right", .active)
                counter(String(localized: "Gecikmeli"), pilots.filter { $0.freshness == "stale" }.count, "clock.badge.exclamationmark", .warning)
                counter(String(localized: "Sinyal yok"), pilots.filter { $0.freshness == "lost" }.count, "antenna.radiowaves.left.and.right.slash", .error)
            }
            HStack(spacing: AeroTokens.Space.s2) {
                counter(String(localized: "Açık retrieve"), open.count, "hand.raised", .warning)
                counter(String(localized: "Görevde retriever"), (live?.retrievers ?? []).filter { $0.onDuty ?? false }.count, "car", .info)
            }
            if !pilots.isEmpty {
                AeroCard {
                    SectionHeader(title: String(localized: "Pilotlar"))
                    ForEach(pilots.sorted { $0.name < $1.name }) { p in
                        HStack {
                            Text(p.name).font(.subheadline)
                            if p.isSimulated { SimBadge() }
                            Spacer()
                            FreshnessBadge(freshness: p.freshness, age: p.age())
                        }
                    }
                }
            }
            if !open.isEmpty {
                AeroCard {
                    SectionHeader(title: String(localized: "Retrieve talepleri"))
                    ForEach(open) { r in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(r.pilot?.fullName ?? String(localized: "Pilot")).font(.subheadline)
                                if let n = r.retriever?.fullName { Text("Retriever: \(n)").font(.caption).foregroundStyle(AeroTokens.textSecondary) }
                            }
                            Spacer()
                            if let s = r.retrievalStatus { StatusPill(s.title, systemImage: s.systemImage, tone: s.tone) }
                        }
                    }
                }
            }
        }
    }

    private func counter(_ title: String, _ n: Int, _ icon: String, _ tone: Tone) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("\(n)", icon: icon).font(.title3.monospacedDigit().weight(.semibold)).foregroundStyle(tone.color)
            Text(title).font(.caption).foregroundStyle(AeroTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AeroTokens.Space.s2)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md))
        .accessibilityElement(children: .combine)
    }
}

/// Not a member: event info + Apply (requested role + message) / application status.
struct ApplySheet: View {
    @Environment(AppModel.self) private var model
    let event: Event
    let state: ApplicationState
    let reload: () async -> Void
    @State private var message = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            switch state {
            case .canApply:
                form
            case .closed:
                AeroCard { WarningRow(text: String(localized: "Bu etkinlik şu an başvuru kabul etmiyor."), tone: .info, systemImage: "lock") }
            case .pending(let id):
                AeroCard {
                    StatusPill(String(localized: "Başvurun inceleniyor"), systemImage: "clock", tone: .warning)
                    Text("Organizatör onaylarken rolünü (pilot, gözlemci veya retriever) belirler; etkinlik ekranın ona göre açılır.")
                        .font(.caption).foregroundStyle(AeroTokens.textSecondary)
                    Button("Başvuruyu geri çek", role: .destructive) { Task { await withdraw(id) } }
                        .disabled(busy)
                }
            case .rejected(_, let canReapply), .withdrawn(_, let canReapply):
                AeroCard {
                    if case .rejected = state {
                        StatusPill(String(localized: "Başvurun reddedildi"), systemImage: "xmark.circle", tone: .neutral)
                    } else {
                        StatusPill(String(localized: "Başvurunu geri çektin"), systemImage: "arrow.uturn.left", tone: .neutral)
                    }
                }
                if canReapply { form }
            }
            if let error { AeroCard { WarningRow(text: error, tone: .error) } }
        }
    }

    private var form: some View {
        AeroCard {
            SectionHeader(title: String(localized: "Etkinliğe başvur"))
            Text("Rol seçmezsin: organizatör başvurunu onaylarken pilot, gözlemci veya retriever olarak belirler.")
                .font(.caption).foregroundStyle(AeroTokens.textSecondary)
            TextField("Organizatöre not (isteğe bağlı), ör. pilot olarak uçacağım", text: $message, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("apply.message")
            Button {
                Task { await apply() }
            } label: {
                if busy { ProgressView() } else { Label("Başvur", icon: "paperplane") }
            }
            .buttonStyle(.aeroPrimary)
            .disabled(busy)
            .accessibilityIdentifier("apply.submit")
        }
    }

    private func apply() async {
        busy = true; defer { busy = false }
        do {
            try await model.api.apply(eventId: event.id, message: message.isEmpty ? nil : message)
            error = nil
            Haptics.success()
            await reload()
        } catch {
            self.error = ErrorText.message(error)
        }
    }

    private func withdraw(_ id: String) async {
        busy = true; defer { busy = false }
        do {
            try await model.api.withdrawApplication(eventId: event.id, applicationId: id)
            await reload()
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}

struct OrganizerToolsCard: View {
    let event: Event
    var body: some View {
        AeroCard {
            SectionHeader(title: String(localized: "Organizatör"))
            NavigationLink(value: EventRoute.applications(event.id)) {
                HStack {
                    Label("Başvurular", icon: "tray.full")
                    Spacer()
                    if let n = event.counts?.pendingApplications, n > 0 {
                        StatusPill(String(localized: "\(n) bekliyor"), systemImage: "clock", tone: .warning)
                    }
                }
            }
            .accessibilityIdentifier("organizer.applications")
            NavigationLink(value: EventRoute.members(event.id)) { Label("Üyeler", icon: "person.3") }
            Text("Etkinlik ayarları, kalkış alanları ve raporlar web uygulamasındadır.").font(.caption).foregroundStyle(AeroTokens.textSecondary)
        }
    }
}

/// Organizer: approve (choosing the granted role) or reject pending applications.
struct ApplicationsInboxView: View {
    @Environment(AppModel.self) private var model
    let eventId: String
    @State private var items: [EventApplication] = []
    @State private var roles: [String: EventRole] = [:]
    @State private var error: String?
    @State private var busy: Set<String> = []
    @State private var loaded = false

    var body: some View {
        List {
            if loaded && items.isEmpty {
                ContentUnavailableView("Bekleyen başvuru yok", systemImage: "tray")
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }
            ForEach(items) { app in
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(app.user?.fullName ?? "—").font(.headline)
                        if let email = app.user?.email { Text(email).font(.caption).foregroundStyle(AeroTokens.textSecondary) }
                        if let m = app.message, !m.isEmpty { Text("“\(m)”").font(.subheadline).foregroundStyle(AeroTokens.textSecondary) }
                        if let d = app.createdAt { Text(Fmt.dateTime(d)).font(.caption2).foregroundStyle(AeroTokens.textMuted) }
                    }
                    // Required choice, no default: the applicant does not pick a role.
                    Picker("Verilecek rol", selection: Binding(get: { roles[app.id] }, set: { roles[app.id] = $0 })) {
                        Text("Rol seç").tag(EventRole?.none)
                        ForEach(EventRole.allCases) { Text($0.title).tag(Optional($0)) }
                    }
                    if let r = roles[app.id] { Text(r.explanation).font(.caption).foregroundStyle(AeroTokens.textSecondary) }
                    HStack {
                        Button("Onayla") { Task { await decide(app, approve: true) } }
                            .buttonStyle(.aeroPrimary)
                            .disabled(roles[app.id] == nil)
                        Button("Reddet", role: .destructive) { Task { await decide(app, approve: false) } }
                            .buttonStyle(.aeroSecondary)
                    }
                    .disabled(busy.contains(app.id))
                }
            }
        }
        .navigationTitle("Başvurular")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do { items = try await model.api.applications(eventId: eventId); error = nil }
        catch { self.error = ErrorText.message(error) }
        loaded = true
    }

    private func decide(_ app: EventApplication, approve: Bool) async {
        busy.insert(app.id); defer { busy.remove(app.id) }
        do {
            if approve {
                guard let role = roles[app.id] else { return }
                try await model.api.approveApplication(eventId: eventId, applicationId: app.id, role: role, note: nil)
            } else {
                try await model.api.rejectApplication(eventId: eventId, applicationId: app.id, note: nil)
            }
            Haptics.tick()
            items.removeAll { $0.id == app.id }
            if let e = try? await model.api.event(eventId) { model.update(event: e) }
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}

struct MembersListView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let eventId: String
    @State private var members: [Member] = []
    @State private var error: String?

    var body: some View {
        List {
            if let error { Section { WarningRow(text: error, tone: .error) } }
            ForEach(EventRole.allCases) { role in
                let list = members.filter { $0.role == role.rawValue && $0.status != "removed" }
                if !list.isEmpty {
                    Section("\(role.title) (\(list.count))") {
                        ForEach(list) { m in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(m.fullName ?? "—")
                                    if m.isOrganizer == true { Text("Organizatör").font(.caption).foregroundStyle(AeroTokens.textSecondary) }
                                }
                                Spacer()
                                if let tel = AppleMaps.telURL(m.phone) {
                                    Button { openURL(tel) } label: { Image(icon: "phone.fill") }
                                        .accessibilityLabel(Text("Ara"))
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Üyeler")
        .task {
            do { members = try await model.api.members(eventId: eventId) } catch { self.error = ErrorText.message(error) }
        }
    }
}
