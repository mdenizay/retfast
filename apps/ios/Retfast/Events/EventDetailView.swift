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
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenTitle(
                    kicker: "MISSION WORKSPACE",
                    title: event.name,
                    subtitle: event.description.isEmpty ? nil : event.description
                )

                Map {
                    ZoneMapContent(overlays: model.overlays)
                }
                .frame(height: 260)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.1)))
                .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 12) {
                    Text("GÖREV EYLEMLERİ")
                        .font(.caption2.weight(.bold)).tracking(1.6)
                        .foregroundStyle(RetfastBrand.amber)
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
                }
                if roles.contains(.retriever) {
                    Button {
                        showRetriever = true
                    } label: {
                        Label("retriever.mode", systemImage: "car.fill")
                    }
                    .buttonStyle(.big(.secondary, height: Hit.critical))
                }
                }
                .operationalPanel()

                HStack {
                    Text("flights.title").font(.title3.weight(.bold))
                    Spacer()
                    Text("\(model.myTasks.count)").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                }
                if model.myTasks.isEmpty {
                    Text("flights.empty").foregroundStyle(.secondary)
                }
                ForEach(model.myTasks) { task in
                    NavigationLink(value: task) {
                        HStack {
                        VStack(alignment: .leading, spacing: 5) {
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
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(.secondary)
                        }
                        .minTapTarget(Hit.comfortable)
                        .operationalPanel(padding: 14)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(RetfastBrand.graphite)
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
