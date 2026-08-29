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
            List {
                if let error = model.error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
                Section("events.mine") {
                    let mine = model.events.filter { !(model.roles[$0.id] ?? []).isEmpty }
                    if mine.isEmpty { Text("events.none").foregroundStyle(.secondary) }
                    ForEach(mine) { event in
                        NavigationLink(value: event) {
                            EventRowView(event: event, roles: model.roles[event.id] ?? [])
                        }
                    }
                }
                Section("events.discover") {
                    HStack {
                        TextField(String(localized: "events.codePlaceholder"), text: $code)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                        Button("events.lookup") {
                            Task {
                                if let found = try? await model.lookupCode(code) {
                                    joinTarget = found
                                }
                            }
                        }
                        .disabled(code.isEmpty)
                    }
                    let discover = model.events.filter { (model.roles[$0.id] ?? []).isEmpty && !$0.isArchived }
                    ForEach(discover) { event in
                        Button {
                            joinTarget = event
                        } label: {
                            EventRowView(event: event, roles: [])
                        }
                        .tint(.primary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(RetfastBrand.graphite)
            .navigationTitle("RETFAST")
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
}

private struct EventRowView: View {
    let event: EventRow
    let roles: [EventRole]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(event.name).font(.headline)
            Text(event.startsAt, style: .date).font(.caption).foregroundStyle(.secondary)
            if !roles.isEmpty {
                HStack(spacing: 4) {
                    ForEach(roles) { role in
                        Text(role.label)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.secondary.opacity(0.15), in: Capsule())
                    }
                }
            }
        }
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
