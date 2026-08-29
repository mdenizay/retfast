import MapKit
import SwiftUI

/// Full-screen operational map for a pilot's task.
///
/// The HUD is the pilot's only feedback loop while flying, so it shows every
/// number the operation cares about — altitude, ground speed, heading, GPS
/// quality, battery and how many fixes are still queued for upload — with
/// tap targets sized for gloves (see ControlStyles.swift).
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
    @State private var now = Date()

    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

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

            VStack(spacing: 0) {
                hud
                Spacer()
                controls
            }
        }
        .onReceive(clock) { now = $0 }
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
        VStack(spacing: 8) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.down")
                }
                .buttonStyle(.mapChip)

                Spacer()
                trackingBadge
            }

            telemetryPanel

            if let error = model.error {
                banner(error, color: .red)
            }
            if model.sosDelivered == false {
                banner(String(localized: "sos.notDelivered"), color: .red, bold: true)
            }
            retrievalStatus
        }
        .padding()
    }

    /// Two rows of large, glanceable readouts.
    private var telemetryPanel: some View {
        let loc = tracking.lastLocation
        // Battery is published by TrackingEngine so UIDevice is only ever read
        // on the main actor, and only when it actually changes.
        let batteryPct = tracking.batteryPercent < 0 ? nil : tracking.batteryPercent
        let fixAge = loc.map { now.timeIntervalSince($0.timestamp) }

        return VStack(spacing: 10) {
            HStack(spacing: 10) {
                readout(
                    "arrow.up.to.line",
                    String(localized: "ops.altitude"),
                    loc.map { "\(Int($0.altitude))" } ?? "—",
                    unit: "m"
                )
                readout(
                    "speedometer",
                    String(localized: "ops.speed"),
                    loc.flatMap { $0.speed >= 0 ? "\(Int($0.speed * 3.6))" : nil } ?? "—",
                    unit: "km/h"
                )
                headingReadout(course: loc.flatMap { $0.course >= 0 ? $0.course : nil })
            }
            HStack(spacing: 10) {
                readout(
                    "dot.radiowaves.up.forward",
                    String(localized: "ops.accuracy"),
                    loc.flatMap { $0.horizontalAccuracy >= 0 ? "±\(Int($0.horizontalAccuracy))" : nil } ?? "—",
                    unit: "m",
                    tint: (loc?.horizontalAccuracy ?? 0) > 50 ? .orange : nil
                )
                readout(
                    batteryIcon(batteryPct),
                    String(localized: "ops.battery"),
                    batteryPct.map { "\($0)" } ?? "—",
                    unit: "%",
                    tint: (batteryPct ?? 100) <= 20 ? .red : nil
                )
                readout(
                    "tray.full",
                    String(localized: "tracking.queue"),
                    "\(sync.pendingCount)",
                    unit: nil,
                    tint: sync.pendingCount > 200 ? .orange : nil
                )
            }
            if let fixAge, fixAge > 30 {
                Text(String(format: String(localized: "tracking.lastFixAgo"), Int(fixAge)))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(fixAge > 120 ? .red : .orange)
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private func readout(
        _ icon: String,
        _ label: String,
        _ value: String,
        unit: String?,
        tint: Color? = nil
    ) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 3) {
                Image(systemName: icon).font(.caption2)
                Text(label).font(.caption2)
            }
            .foregroundStyle(.secondary)

            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value)
                    .font(.title3.weight(.bold).monospacedDigit())
                if let unit {
                    Text(unit).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .foregroundStyle(tint ?? .primary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) \(value) \(unit ?? "")")
    }

    /// Heading gets a rotating arrow so it reads at a glance in flight.
    private func headingReadout(course: Double?) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 3) {
                Image(systemName: "location.north.line").font(.caption2)
                Text("ops.heading").font(.caption2)
            }
            .foregroundStyle(.secondary)

            HStack(spacing: 4) {
                Image(systemName: "location.north.fill")
                    .font(.caption)
                    .rotationEffect(.degrees(course ?? 0))
                    .opacity(course == nil ? 0.3 : 1)
                Text(course.map { "\(Int($0))°" } ?? "—")
                    .font(.title3.weight(.bold).monospacedDigit())
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func batteryIcon(_ pct: Int?) -> String {
        guard let pct else { return "battery.0percent" }
        return switch pct {
        case ..<15: "battery.0percent"
        case ..<40: "battery.25percent"
        case ..<70: "battery.50percent"
        default: "battery.100percent"
        }
    }

    private func banner(_ text: String, color: Color, bold: Bool = false) -> some View {
        Text(text)
            .font(bold ? .callout.weight(.bold) : .caption)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(10)
            .background(color, in: RoundedRectangle(cornerRadius: 10))
    }

    private var trackingBadge: some View {
        let (color, text): (Color, LocalizedStringKey) = {
            guard model.isTracking else { return (.gray, "tracking.off") }
            guard tracking.isTracking else { return (.red, "tracking.stopped") }
            if let age = tracking.lastLocation.map({ now.timeIntervalSince($0.timestamp) }), age > 30 {
                return (.orange, "tracking.stale")
            }
            return (.green, "tracking.live")
        }()
        return HStack(spacing: 7) {
            Circle().fill(color).frame(width: 10, height: 10)
            Text(text).font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 14)
        .frame(minHeight: Hit.min)
        .background(.thinMaterial, in: Capsule())
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
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14)
            .frame(minHeight: Hit.min)
            .foregroundStyle(.white)
            .background(color, in: Capsule())
    }

    // MARK: controls

    private var controls: some View {
        VStack(spacing: 12) {
            if model.task == nil {
                Button {
                    Task { await model.startTask() }
                } label: {
                    Label("task.start", systemImage: "paperplane.fill")
                }
                .buttonStyle(.big(.primary, height: Hit.critical))
            } else if model.isTracking {
                HStack(spacing: 12) {
                    if model.task?.status == .active {
                        Button {
                            Task { await model.transition("landed") }
                        } label: {
                            Label("task.landed", systemImage: "arrow.down.to.line")
                        }
                        .buttonStyle(.big(.warning, height: Hit.critical))
                    } else {
                        Button {
                            showRetrieverPicker = true
                            Task { await model.loadNearby() }
                        } label: {
                            Label("retrieval.request", systemImage: "car.fill")
                        }
                        .buttonStyle(.big(.success, height: Hit.critical))
                    }

                    Button {
                        Task {
                            await model.transition("finish")
                            dismiss()
                        }
                    } label: {
                        Label("task.finish", systemImage: "checkmark")
                    }
                    .buttonStyle(.big(.secondary, height: Hit.critical))
                }

                HStack(spacing: 12) {
                    Button {
                        showCancelPrompt = true
                    } label: {
                        Label("task.cancel", systemImage: "xmark")
                    }
                    .buttonStyle(.big(.secondary, height: Hit.comfortable))

                    sosButton
                }
            }
        }
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding()
    }

    /// Two-stage SOS: arm, then confirm — an accidental brush must not page
    /// the whole operation, but a real one must be two quick taps.
    private var sosButton: some View {
        Button {
            if sosArmed {
                sosArmed = false
                Task { await model.raiseSOS() }
            } else {
                sosArmed = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) { sosArmed = false }
            }
        } label: {
            Label(sosArmed ? "sos.confirm" : "SOS", systemImage: "sos")
        }
        .buttonStyle(.big(.destructive, height: Hit.comfortable))
        .opacity(sosArmed ? 1 : 0.85)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(.white, lineWidth: sosArmed ? 3 : 0)
        )
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
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(r.displayName).font(.headline)
                                Text("\(r.vehicleDescription) · \(r.vehicleCapacity - r.occupiedSeats) \(String(localized: "retrieval.seatsFree"))")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(String(format: "%.1f km", r.distanceM / 1000))
                                .font(.headline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .minTapTarget(Hit.critical)
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
