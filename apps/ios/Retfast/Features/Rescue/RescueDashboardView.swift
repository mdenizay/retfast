import CoreLocation
import RetfastCore
import SwiftUI

/// Rescue dashboard: active + assigned incidents. Visible only to responders;
/// the server still decides what each user may see.
struct RescueDashboardView: View {
    @Environment(AppModel.self) private var model
    @State private var incidents: [Incident] = []
    @State private var assignments: [Assignment] = []
    @State private var error: String?
    @State private var loaded = false
    @State private var lastRefresh: Date?
    @State private var here: CLLocation?
    @State private var locator = OneShotLocation()

    var body: some View {
        List {
            if let error {
                Section { WarningRow(text: error, tone: .error) }
            }
            Section {
                HStack {
                    ConnectionPill(state: model.realtimeState)
                    Spacer()
                    if let lastRefresh {
                        Text("Güncelleme \(Fmt.time(lastRefresh))").font(.caption).foregroundStyle(AeroTokens.textMuted)
                    }
                }
            }
            if !assignments.isEmpty {
                Section("Bana atananlar") {
                    ForEach(assignments) { a in
                        if let inc = incidents.first(where: { $0.id == a.incidentId }) {
                            NavigationLink { IncidentDetailView(incident: inc) } label: { IncidentRow(incident: inc, here: here, assignment: a) }
                        } else {
                            HStack {
                                Text("Olay \(String((a.incidentId ?? a.id).prefix(8)))").font(.subheadline.monospaced())
                                Spacer()
                                AssignmentStatusPill(status: a.status)
                            }
                        }
                    }
                }
            }
            Section("Aktif olaylar") {
                if incidents.isEmpty && loaded && error == nil {
                    Label("Aktif acil durum yok.", systemImage: "checkmark.shield").foregroundStyle(AeroTokens.textSecondary)
                }
                ForEach(incidents) { inc in
                    NavigationLink { IncidentDetailView(incident: inc) } label: { IncidentRow(incident: inc, here: here, assignment: nil) }
                }
            }
        }
        .navigationTitle("Kurtarma")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { RescueMapView() } label: { Label("Harita", systemImage: "map") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { TeamStatusView() } label: { Label("Ekip", systemImage: "person.3") }
            }
        }
        .refreshable { await load() }
        .task { await run() }
    }

    private func run() async {
        await load()
        here = await locator.current()
        let realtime = model.realtime
        await realtime.connect()
        await realtime.subscribe("incidents")
        // Realtime updates + 15 s polling fallback (realtime is best-effort).
        let listener = Task { @MainActor in
            for await message in realtime.messages.stream() {
                if Task.isCancelled { return }
                if case .incident(let inc) = message { apply(inc) }
            }
        }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            if Task.isCancelled { break }
            await load()
        }
        listener.cancel()
        await realtime.unsubscribe("incidents")
    }

    private func apply(_ inc: Incident) {
        incidents.removeAll { $0.id == inc.id }
        if inc.isActive { incidents.append(inc) }
        incidents.sort(by: Incident.urgencyOrder)
        lastRefresh = Date()
    }

    private func load() async {
        do {
            let list = try await model.api.incidents(status: ["open", "acknowledged", "responding"])
            incidents = list.sorted(by: Incident.urgencyOrder)
            error = nil
        } catch {
            self.error = RescueText.message(error)
        }
        if let mine = try? await model.api.myAssignments() {
            assignments = mine.filter { $0.status != "completed" && $0.status != "withdrawn" }
        }
        loaded = true
        lastRefresh = Date()
    }
}

struct IncidentRow: View {
    let incident: Incident
    let here: CLLocation?
    let assignment: Assignment?

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s1) {
            HStack(spacing: AeroTokens.Space.s2) {
                if incident.isTest ?? false { TestBadge() }
                Text(incident.pilotName).font(.headline)
                Spacer()
                IncidentStatusPill(incident: incident)
            }
            HStack(spacing: AeroTokens.Space.s2) {
                TimelineView(.periodic(from: .now, by: 5)) { ctx in
                    if let t = incident.lastFixTime {
                        FreshnessBadge(freshness: nil, age: ctx.date.timeIntervalSince(t))
                    } else {
                        StatusPill(String(localized: "Konum yok"), systemImage: "location.slash", tone: .error)
                    }
                }
                if let c = incident.bestCoordinate, let here {
                    let d = Fmt.distance(here.distance(from: CLLocation(latitude: c.latitude, longitude: c.longitude)))
                    Label("\(d.0) \(d.1)", systemImage: "location").font(.caption.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary)
                }
                if let assignment { AssignmentStatusPill(status: assignment.status) }
            }
            if let received = incident.receivedAt {
                Text("Alındı \(Fmt.relative(received))").font(.caption).foregroundStyle(AeroTokens.textMuted)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
