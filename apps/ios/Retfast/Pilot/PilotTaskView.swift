import MapKit
import SwiftUI

/// Full-screen operational map for a pilot's task.
struct PilotTaskView: View {
    let event: EventRow
    let existingTask: TaskRow?

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: PilotTaskModel
    @ObservedObject private var tracking = TrackingEngine.shared
    @ObservedObject private var sync = SyncEngine.shared
    @State private var overlays: [ZoneOverlay] = []
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var showCancelPrompt = false
    @State private var cancelReason = ""
    @State private var showRetrieverPicker = false
    @State private var sosArmed = false

    init(event: EventRow, existingTask: TaskRow?) {
        self.event = event
        self.existingTask = existingTask
        _model = StateObject(wrappedValue: PilotTaskModel(event: event, existingTask: existingTask))
    }

    var body: some View {
        ZStack {
            Map(position: $camera) {
                UserAnnotation()
                ZoneMapContent(overlays: overlays)
            }
            .mapControls {
                MapUserLocationButton()
                MapCompass()
            }
            .ignoresSafeArea()

            VStack {
                hud
                Spacer()
                controls
            }
        }
        .task {
            TrackingEngine.shared.requestPermissions()
            if let zones: [GeoZone] = try? await supa.from("geo_zones")
                .select("id, name, zone_type, geometry")
                .eq("event_id", value: event.id)
                .execute().value
            {
                overlays = parseZoneOverlays(zones)
            }
            model.resumeIfNeeded()
            await model.poll()
        }
        .alert("task.cancelReason", isPresented: $showCancelPrompt) {
            TextField(String(localized: "task.cancelReasonPlaceholder"), text: $cancelReason)
            Button("task.cancel", role: .destructive) {
                Task {
                    await model.transition("cancel", reason: cancelReason)
                    dismiss()
                }
            }
            Button("common.back", role: .cancel) {}
        }
        .sheet(isPresented: $showRetrieverPicker) {
            RetrieverPickerView(model: model)
        }
    }

    // MARK: HUD

    private var hud: some View {
        VStack(spacing: 6) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.down")
                        .padding(10)
                        .background(.thinMaterial, in: Circle())
                }
                Spacer()
                trackingBadge
            }
            HStack(spacing: 14) {
                hudItem("arrow.up", tracking.lastLocation.map { "\(Int($0.altitude)) m" } ?? "—")
                hudItem("speedometer", tracking.lastLocation.flatMap {
                    $0.speed >= 0 ? "\(Int($0.speed * 3.6)) km/h" : nil
                } ?? "—")
                hudItem("safari", tracking.lastLocation.flatMap {
                    $0.course >= 0 ? "\(Int($0.course))°" : nil
                } ?? "—")
                hudItem("tray.full", "\(sync.pendingCount)")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))

            if let error = model.error {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.white)
                    .padding(6)
                    .background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
            }
            if model.sosDelivered == false {
                Text("sos.notDelivered")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(8)
                    .background(.red, in: RoundedRectangle(cornerRadius: 8))
            }
            retrievalStatus
        }
        .padding()
    }

    private var trackingBadge: some View {
        let (color, text): (Color, LocalizedStringKey) = {
            guard model.isTracking else { return (.gray, "tracking.off") }
            guard tracking.isTracking else { return (.red, "tracking.stopped") }
            if let age = tracking.lastLocation.map({ -$0.timestamp.timeIntervalSinceNow }), age > 30 {
                return (.orange, "tracking.stale")
            }
            return (.green, "tracking.live")
        }()
        return HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: Capsule())
    }

    private func hudItem(_ icon: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.caption)
            Text(value).font(.caption.weight(.semibold).monospacedDigit())
        }
    }

    @ViewBuilder
    private var retrievalStatus: some View {
        if let assignment = model.assignment {
            statusChip(color: .green, text: assignment.status.pilotLabel)
        } else if let request = model.request {
            switch request.status {
            case .pending:
                statusChip(color: .orange, text: String(localized: "retrieval.waiting"))
            case .declined, .expired:
                statusChip(color: .red, text: String(localized: "retrieval.declined"))
            default:
                EmptyView()
            }
        }
    }

    private func statusChip(color: Color, text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .foregroundStyle(.white)
            .background(color, in: Capsule())
    }

    // MARK: controls

    private var controls: some View {
        VStack(spacing: 10) {
            if model.task == nil {
                Button {
                    Task { await model.startTask() }
                } label: {
                    Label("task.start", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
            } else if model.isTracking {
                HStack(spacing: 10) {
                    if model.task?.status == .active {
                        Button {
                            Task { await model.transition("landed") }
                        } label: {
                            Label("task.landed", systemImage: "arrow.down.to.line")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.orange)
                    } else {
                        Button {
                            showRetrieverPicker = true
                            Task { await model.loadNearby() }
                        } label: {
                            Label("retrieval.request", systemImage: "car.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                    }
                    Button {
                        Task {
                            await model.transition("finish")
                            dismiss()
                        }
                    } label: {
                        Label("task.finish", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                HStack(spacing: 10) {
                    Button(role: .destructive) {
                        showCancelPrompt = true
                    } label: {
                        Label("task.cancel", systemImage: "xmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    sosButton
                }
            }
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding()
    }

    private var sosButton: some View {
        Button {
            if sosArmed {
                sosArmed = false
                Task { await model.raiseSOS() }
            } else {
                sosArmed = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) { sosArmed = false }
            }
        } label: {
            Label(sosArmed ? "sos.confirm" : "SOS", systemImage: "sos")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(sosArmed ? .red : .red.opacity(0.7))
    }
}

extension AssignmentStatus {
    var pilotLabel: String {
        switch self {
        case .assigned: String(localized: "retrieval.assigned")
        case .enRoute: String(localized: "retrieval.enRoute")
        case .pickedUp: String(localized: "retrieval.pickedUp")
        case .delivered: String(localized: "retrieval.delivered")
        case .completed: String(localized: "retrieval.completed")
        case .cancelled: String(localized: "retrieval.cancelled")
        }
    }
}

/// Nearest available retrievers; tapping one sends the 60 s offer.
struct RetrieverPickerView: View {
    @ObservedObject var model: PilotTaskModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.nearby.isEmpty {
                    Text("retrieval.nobodyNearby").foregroundStyle(.secondary)
                }
                ForEach(model.nearby) { r in
                    Button {
                        Task {
                            await model.requestRetrieval(from: r)
                            dismiss()
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(r.displayName).font(.headline)
                                Spacer()
                                Text(String(format: "%.1f km", r.distanceM / 1000))
                                    .font(.subheadline.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            Text("\(r.vehicleDescription) · \(r.vehicleCapacity - r.occupiedSeats) \(String(localized: "retrieval.seatsFree"))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .tint(.primary)
                }
            }
            .navigationTitle("retrieval.pick")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.loadNearby() }
        }
        .presentationDetents([.medium, .large])
    }
}
