import MapKit
import SwiftUI

/// Retriever mode: map on top, duty toggle + jobs below.
struct RetrieverView: View {
    let event: EventRow
    let overlays: [ZoneOverlay]

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: RetrieverModel
    @ObservedObject private var sync = SyncEngine.shared
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var showVehicleEditor = false
    @State private var now = Date()

    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    init(event: EventRow, overlays: [ZoneOverlay]) {
        self.event = event
        self.overlays = overlays
        _model = StateObject(wrappedValue: RetrieverModel(event: event))
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                Map(position: $camera) {
                    UserAnnotation()
                    ZoneMapContent(overlays: overlays)
                    ForEach(model.pilotPins) { pin in
                        Annotation(pin.name, coordinate: pin.coordinate) {
                            Image(systemName: "figure.fall")
                                .padding(6)
                                .background(.orange, in: Circle())
                                .foregroundStyle(.white)
                        }
                    }
                }
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.down")
                }
                .buttonStyle(.mapChip)
                .padding()
            }
            .frame(maxHeight: .infinity)

            jobsPanel
                .frame(maxHeight: 380)
        }
        .task { await model.appear() }
        .onReceive(clock) { now = $0 }
        .sheet(isPresented: $showVehicleEditor) {
            VehicleEditor(model: model)
        }
    }

    // MARK: bottom panel

    private var jobsPanel: some View {
        List {
            Section {
                Toggle(isOn: Binding(
                    get: { model.onDuty },
                    set: { _ in Task { await model.toggleDuty() } }
                )) {
                    Label("retriever.onDuty", systemImage: "car.fill")
                }
                if let p = model.profileRow {
                    HStack {
                        Text("retriever.capacity")
                        Spacer()
                        Text("\(p.occupiedSeats)/\(p.vehicleCapacity)")
                            .foregroundStyle(.secondary)
                        Button("retriever.editVehicle") { showVehicleEditor = true }
                            .buttonStyle(.borderless)
                            .minTapTarget()
                    }
                }
                if model.onDuty {
                    HStack {
                        Text("tracking.queue")
                        Spacer()
                        Text("\(sync.pendingCount)").foregroundStyle(.secondary)
                    }
                    .font(.footnote)
                }
                if let error = model.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }

            if let req = model.pendingRequest {
                Section("retrieval.incoming") {
                    IncomingRequestRow(request: req, model: model, now: now)
                }
            }

            Section("retriever.jobs") {
                if model.assignments.isEmpty {
                    Text("retriever.noJobs").foregroundStyle(.secondary)
                }
                ForEach(model.assignments) { a in
                    AssignmentRow(assignment: a, model: model)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(RetfastBrand.graphite)
        .listStyle(.insetGrouped)
    }
}

private struct IncomingRequestRow: View {
    let request: RetrievalRequestRow
    @ObservedObject var model: RetrieverModel
    let now: Date

    var body: some View {
        let remaining = max(0, Int(request.expiresAt.timeIntervalSince(now)))
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(model.pilotNames[request.pilotId] ?? String(localized: "role.pilot"))
                    .font(.headline)
                Spacer()
                Text("\(remaining)s")
                    .font(.title3.monospacedDigit().weight(.bold))
                    .foregroundStyle(remaining <= 10 ? .red : .orange)
            }
            HStack {
                Button {
                    Task { await model.respond(request, accept: true) }
                } label: {
                    Label("retrieval.accept", systemImage: "checkmark")
                }
                .buttonStyle(.big(.success, height: Hit.critical))

                Button {
                    Task { await model.respond(request, accept: false) }
                } label: {
                    Label("retrieval.decline", systemImage: "xmark")
                }
                .buttonStyle(.big(.secondary, height: Hit.critical))
            }
        }
        .padding(.vertical, 8)
    }
}

private struct AssignmentRow: View {
    let assignment: RetrievalAssignmentRow
    @ObservedObject var model: RetrieverModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(model.pilotNames[assignment.pilotId] ?? String(localized: "role.pilot"))
                    .font(.headline)
                Spacer()
                Text(assignment.status.pilotLabel)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.secondary.opacity(0.15), in: Capsule())
            }
            if let pin = model.pilotPins.first(where: { $0.id == assignment.taskId }) {
                NavigationAppsRow(coordinate: pin.coordinate, name: pin.name)
            }
            HStack(spacing: 10) {
                ForEach(nextActions(), id: \.self) { action in
                    Button(actionLabel(action)) {
                        Task { await model.advance(assignment, action: action) }
                    }
                    .buttonStyle(.big(action == "cancel" ? .secondary : .primary))
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func nextActions() -> [String] {
        switch assignment.status {
        case .assigned: ["en_route", "cancel"]
        case .enRoute: ["picked_up", "cancel"]
        case .pickedUp: ["delivered"]
        case .delivered: ["completed"]
        default: []
        }
    }

    private func actionLabel(_ action: String) -> String {
        switch action {
        case "en_route": String(localized: "retrieval.action.enRoute")
        case "picked_up": String(localized: "retrieval.action.pickedUp")
        case "delivered": String(localized: "retrieval.action.delivered")
        case "completed": String(localized: "retrieval.action.completed")
        default: String(localized: "retrieval.action.cancel")
        }
    }
}

/// Hand the pilot's coordinates to whichever navigation apps are installed.
struct NavigationAppsRow: View {
    let coordinate: CLLocationCoordinate2D
    let name: String

    var body: some View {
        HStack(spacing: 8) {
            Button("nav.appleMaps") {
                let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
                item.name = name
                item.openInMaps(launchOptions: [
                    MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving,
                ])
            }
            if let google = URL(string: "comgooglemaps://?daddr=\(coordinate.latitude),\(coordinate.longitude)&directionsmode=driving"),
               UIApplication.shared.canOpenURL(google)
            {
                Button("nav.googleMaps") { UIApplication.shared.open(google) }
            }
            if let yandex = URL(string: "yandexnavi://build_route_on_map?lat_to=\(coordinate.latitude)&lon_to=\(coordinate.longitude)"),
               UIApplication.shared.canOpenURL(yandex)
            {
                Button("nav.yandex") { UIApplication.shared.open(yandex) }
            }
        }
        .buttonStyle(.big(.secondary, height: Hit.min))
    }
}

private struct VehicleEditor: View {
    @ObservedObject var model: RetrieverModel
    @Environment(\.dismiss) private var dismiss
    @State private var capacity = 3
    @State private var description = ""

    var body: some View {
        NavigationStack {
            Form {
                Stepper(value: $capacity, in: 1...20) {
                    HStack {
                        Text("retriever.capacity")
                        Spacer()
                        Text("\(capacity)").foregroundStyle(.secondary)
                    }
                }
                TextField(String(localized: "retriever.vehicleDescription"), text: $description)
                Button("common.save") {
                    Task {
                        await model.updateVehicle(capacity: capacity, description: description)
                        dismiss()
                    }
                }
            }
            .navigationTitle("retriever.editVehicle")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let p = model.profileRow {
                    capacity = p.vehicleCapacity
                    description = p.vehicleDescription
                }
            }
        }
        .presentationDetents([.medium])
    }
}
