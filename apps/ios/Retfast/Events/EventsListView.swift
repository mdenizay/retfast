import SwiftUI

struct MembershipInfo: Codable {
    let eventId: UUID
    let role: EventRole

    enum CodingKeys: String, CodingKey {
        case role
        case eventId = "event_id"
    }
}

@MainActor
final class EventsListModel: ObservableObject {
    @Published var events: [EventRow] = []
    @Published var roles: [UUID: [EventRole]] = [:]
    @Published var error: String?

    func load(userId: UUID) async {
        do {
            let events: [EventRow] = try await supa.from("events")
                .select()
                .order("starts_at", ascending: false)
                .execute().value
            let memberships: [MembershipInfo] = try await supa.from("event_members")
                .select("event_id, role")
                .eq("user_id", value: userId)
                .execute().value
            self.events = events
            self.roles = Dictionary(grouping: memberships, by: \.eventId)
                .mapValues { $0.map(\.role) }
            self.error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func requestParticipation(event: UUID, role: EventRole, code: String?) async throws {
        struct Params: Encodable {
            let p_event: UUID
            let p_role: String
            let p_message: String
            let p_invite_code: String?
        }
        _ = try await supa.rpc(
            "request_participation",
            params: Params(p_event: event, p_role: role.rawValue, p_message: "", p_invite_code: code)
        ).execute()
    }

    func lookupCode(_ code: String) async throws -> EventRow? {
        let rows: [EventRow] = try await supa.rpc(
            "join_event_by_code",
            params: ["p_code": code]
        ).execute().value
        return rows.first
    }
}

struct EventsListView: View {
    @EnvironmentObject var auth: AuthModel
    @StateObject private var model = EventsListModel()
    @State private var code = ""
    @State private var joinTarget: EventRow?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    HStack(alignment: .top) {
                        ScreenTitle(
                            kicker: "MISSION CONTROL",
                            title: String(localized: "events.mine"),
                            subtitle: "Uçuş, toplama ve canlı operasyon görevlerine tek ekrandan eriş."
                        )
                        Spacer()
                        StatusPill(text: "tracking.live")
                    }

                    let mine = model.events.filter { !(model.roles[$0.id] ?? []).isEmpty }
                    HStack(spacing: 12) {
                        metric(icon: "calendar", value: "\(mine.count)", label: "Aktif etkinlik")
                        metric(icon: "location.north.fill", value: "Hazır", label: "Takip sistemi")
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("DAVET KODU")
                            .font(.caption2.weight(.bold)).tracking(1.5)
                            .foregroundStyle(RetfastBrand.amber)
                        HStack(spacing: 10) {
                            TextField(String(localized: "events.codePlaceholder"), text: $code)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .padding(.horizontal, 14)
                                .frame(minHeight: Hit.comfortable)
                                .background(RetfastBrand.surfaceHigh, in: RoundedRectangle(cornerRadius: 14))
                            Button {
                                Task {
                                    if let found = try? await model.lookupCode(code) { joinTarget = found }
                                }
                            } label: { Image(systemName: "arrow.up.right") }
                                .buttonStyle(.big(.primary, height: Hit.comfortable))
                                .frame(width: 58)
                                .disabled(code.isEmpty)
                        }
                    }
                    .operationalPanel()

                    sectionTitle("events.mine", count: mine.count)
                    if mine.isEmpty { emptyState("events.none") }
                    ForEach(mine) { event in
                        NavigationLink(value: event) {
                            EventRowView(event: event, roles: model.roles[event.id] ?? [])
                        }
                        .buttonStyle(.plain)
                    }

                    let discover = model.events.filter { (model.roles[$0.id] ?? []).isEmpty && !$0.isArchived }
                    sectionTitle("events.discover", count: discover.count)
                    ForEach(discover) { event in
                        Button { joinTarget = event } label: { EventRowView(event: event, roles: []) }
                            .buttonStyle(.plain)
                    }

                    if let error = model.error {
                        Text(error).foregroundStyle(.red).font(.footnote)
                    }
                }
                .padding(16)
            }
            .background(RetfastBrand.graphite)
            .navigationTitle("RETFAST")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: EventRow.self) { event in
                EventDetailView(event: event, roles: model.roles[event.id] ?? [])
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("auth.signOut", role: .destructive) {
                            Task { await auth.signOut() }
                        }
                    } label: {
                        Image(systemName: "person.circle")
                    }
                }
            }
            .refreshable {
                if let id = auth.session?.user.id { await model.load(userId: id) }
            }
            .task {
                if let id = auth.session?.user.id { await model.load(userId: id) }
            }
            .sheet(item: $joinTarget) { event in
                JoinSheet(event: event, code: code, model: model) {
                    joinTarget = nil
                    Task {
                        if let id = auth.session?.user.id { await model.load(userId: id) }
                    }
                }
            }
        }
    }

    private func metric(icon: String, value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon).foregroundStyle(RetfastBrand.amber)
            Text(value).font(.title2.weight(.bold).monospacedDigit())
            Text(label).font(.caption).foregroundStyle(RetfastBrand.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .operationalPanel()
    }

    private func sectionTitle(_ key: LocalizedStringKey, count: Int) -> some View {
        HStack {
            Text(key).font(.title3.weight(.bold))
            Text("\(count)").font(.caption.weight(.bold)).padding(.horizontal, 8).padding(.vertical, 4)
                .background(RetfastBrand.surfaceHigh, in: Capsule())
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
        }
    }

    private func emptyState(_ key: LocalizedStringKey) -> some View {
        Text(key).font(.subheadline).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity).padding(28)
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.1), style: StrokeStyle(lineWidth: 1, dash: [6])))
    }
}

private struct EventRowView: View {
    let event: EventRow
    let roles: [EventRole]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "location.north.fill")
                    .frame(width: 42, height: 42)
                    .foregroundStyle(RetfastBrand.amber)
                    .background(RetfastBrand.amber.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 3) {
                    Text(event.name).font(.headline)
                    Text(event.startsAt, style: .date).font(.caption).foregroundStyle(RetfastBrand.muted)
                }
                Spacer()
                Image(systemName: "arrow.up.right").foregroundStyle(RetfastBrand.muted)
            }
            if !event.description.isEmpty {
                Text(event.description).font(.subheadline).foregroundStyle(RetfastBrand.muted).lineLimit(2)
            }
            if !roles.isEmpty {
                HStack(spacing: 4) {
                    ForEach(roles) { role in
                        Text(role.label)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .foregroundStyle(RetfastBrand.amber)
                            .background(RetfastBrand.amber.opacity(0.1), in: Capsule())
                    }
                }
            }
        }
        .operationalPanel(padding: 16)
    }
}

private struct JoinSheet: View {
    let event: EventRow
    let code: String
    let model: EventsListModel
    let onDone: () -> Void
    @State private var role: EventRole = .pilot
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(event.name) {
                    Picker("events.requestedRole", selection: $role) {
                        ForEach([EventRole.pilot, .retriever, .observer]) { r in
                            Text(r.label).tag(r)
                        }
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
                Button("events.sendRequest") {
                    Task {
                        do {
                            try await model.requestParticipation(
                                event: event.id, role: role,
                                code: code.isEmpty ? nil : code
                            )
                            onDone()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
            }
            .navigationTitle("events.requestRole")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}

extension EventRole {
    var label: String {
        switch self {
        case .pilot: String(localized: "role.pilot")
        case .retriever: String(localized: "role.retriever")
        case .observer: String(localized: "role.observer")
        case .eventAdmin: String(localized: "role.eventAdmin")
        }
    }
}
