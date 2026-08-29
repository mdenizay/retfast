import MapKit
import SwiftUI

/// Historical flight replay: full track polyline + timeline scrubbing.
struct ReplayView: View {
    let task: TaskRow

    @State private var track: TaskTrack?
    @State private var index: Double = 0
    @State private var playing = false
    @State private var camera: MapCameraPosition = .automatic

    private let clock = Timer.publish(every: 0.15, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            Map(position: $camera) {
                if let points = track?.points, points.count > 1 {
                    MapPolyline(coordinates: points.map(coord))
                        .stroke(.blue, lineWidth: 3)
                    let current = points[min(Int(index), points.count - 1)]
                    Annotation("", coordinate: coord(current)) {
                        Circle()
                            .fill(.blue)
                            .frame(width: 14, height: 14)
                            .overlay(Circle().stroke(.white, lineWidth: 3))
                    }
                }
            }

            controlBar
        }
        .navigationTitle(task.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onReceive(clock) { _ in
            guard playing, let points = track?.points, !points.isEmpty else { return }
            if Int(index) >= points.count - 1 {
                playing = false
            } else {
                index += 1
            }
        }
    }

    private func coord(_ p: TrackPoint) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng)
    }

    private var controlBar: some View {
        VStack(spacing: 8) {
            if let stats = track?.stats {
                HStack(spacing: 16) {
                    statItem("point.topleft.down.curvedto.point.bottomright.up", String(format: "%.1f km", stats.distanceM / 1000))
                    statItem("arrow.up", stats.maxAltitudeM.map { "\(Int($0)) m" } ?? "—")
                    statItem("speedometer", stats.maxSpeedMps.map { "\(Int($0 * 3.6)) km/h" } ?? "—")
                }
                .font(.caption)
            }
            HStack(spacing: 12) {
                Button {
                    playing.toggle()
                } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.title3)
                }
                .disabled((track?.points.count ?? 0) < 2)

                Slider(
                    value: $index,
                    in: 0...Double(max(1, (track?.points.count ?? 1) - 1)),
                    step: 1
                )

                if let points = track?.points, !points.isEmpty {
                    let current = points[min(Int(index), points.count - 1)]
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(current.recordedAt, style: .time)
                            .font(.caption.monospacedDigit())
                        Text(current.altitudeM.map { "\(Int($0)) m" } ?? "—")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(.thinMaterial)
    }

    private func statItem(_ icon: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
            Text(value).monospacedDigit()
        }
    }

    private func load() async {
        track = try? await supa.rpc("task_track", params: ["p_task": task.id]).execute().value
        if let first = track?.points.first {
            camera = .region(MKCoordinateRegion(
                center: coord(first),
                span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
            ))
        }
    }
}
