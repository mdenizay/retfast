import MapKit
import SwiftUI

@MainActor
final class EventDetailModel: ObservableObject {
    @Published var zones: [GeoZone] = []
    @Published var overlays: [ZoneOverlay] = []
    @Published var myTasks: [TaskRow] = []
    @Published var openTask: TaskRow?

    func load(eventId: UUID, userId: UUID) async {
        if let zones: [GeoZone] = try? await supa.from("geo_zones")
            .select("id, name, zone_type, geometry")
            .eq("event_id", value: eventId)
            .execute().value
        {
            self.zones = zones
            self.overlays = parseZoneOverlays(zones)
        }
        if let tasks: [TaskRow] = try? await supa.from("tasks")
            .select()
            .eq("event_id", value: eventId)
            .eq("pilot_id", value: userId)
            .order("started_at", ascending: false)
            .execute().value
        {
            self.myTasks = tasks
            self.openTask = tasks.first { $0.status == .active || $0.status == .landed }
        }
    }
}

struct EventDetailView: View {
    let event: EventRow
    let roles: [EventRole]
    @EnvironmentObject var auth: AuthModel
    @StateObject private var model = EventDetailModel()
    @State private var showPilot = false
    @State private var showRetriever = false

    var body: some View {
        List {
            Section {
                Map {
                    ZoneMapContent(overlays: model.overlays)
                }
                .frame(height: 240)
                .listRowInsets(EdgeInsets())
                .allowsHitTesting(false)
            }

            if !event.description.isEmpty {
                Section { Text(event.description).font(.subheadline) }
            }

            Section("event.actions") {
                if roles.contains(.pilot) {
                    Button {
                        showPilot = true
                    } label: {
                        Label(
                            model.openTask == nil ? "task.start" : "task.resume",
                            systemImage: "paperplane.fill"
                        )
                    }
                    .buttonStyle(.big(.primary, height: Hit.critical))
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
                if roles.contains(.retriever) {
                    Button {
                        showRetriever = true
                    } label: {
                        Label("retriever.mode", systemImage: "car.fill")
                    }
                    .buttonStyle(.big(.secondary, height: Hit.critical))
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
            }

            Section("flights.title") {
                if model.myTasks.isEmpty {
                    Text("flights.empty").foregroundStyle(.secondary)
                }
                ForEach(model.myTasks) { task in
                    NavigationLink(value: task) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(task.title).font(.subheadline)
                            HStack {
                                Text(task.status.label)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(task.status == .active ? .blue : .secondary)
                                Text(task.startedAt, style: .date)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .minTapTarget(Hit.comfortable)
                    }
                }
            }
        }
        .navigationTitle(event.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: TaskRow.self) { task in
            ReplayView(task: task)
        }
        .fullScreenCover(isPresented: $showPilot, onDismiss: reload) {
            PilotTaskView(event: event, existingTask: model.openTask)
        }
        .fullScreenCover(isPresented: $showRetriever, onDismiss: reload) {
            RetrieverView(event: event, overlays: model.overlays)
        }
        .task { reload() }
        .refreshable { await loadAsync() }
    }

    private func reload() {
        Task { await loadAsync() }
    }

    private func loadAsync() async {
        if let id = auth.session?.user.id {
            await model.load(eventId: event.id, userId: id)
        }
    }
}

extension TaskStatus {
    var label: String {
        switch self {
        case .active: String(localized: "task.status.active")
        case .landed: String(localized: "task.status.landed")
        case .completed: String(localized: "task.status.completed")
        case .cancelled: String(localized: "task.status.cancelled")
        }
    }
}
