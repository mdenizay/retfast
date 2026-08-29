import MapKit
import SwiftUI

/// Parsed, renderable form of a GeoJSON zone.
struct ZoneOverlay: Identifiable {
    let id: UUID
    let name: String
    let color: Color
    let polygons: [MKPolygon]
    let polylines: [MKPolyline]
    let points: [CLLocationCoordinate2D]
}

enum ZonePalette {
    static func color(for zoneType: String) -> Color {
        switch zoneType {
        case "takeoff": .green
        case "landing": .blue
        case "restricted": .red
        case "checkpoint": .orange
        default: .purple
        }
    }
}

func parseZoneOverlays(_ zones: [GeoZone]) -> [ZoneOverlay] {
    let decoder = MKGeoJSONDecoder()
    return zones.compactMap { zone in
        guard let objects = try? decoder.decode(zone.geometry.jsonData) else { return nil }
        var polygons: [MKPolygon] = []
        var polylines: [MKPolyline] = []
        var points: [CLLocationCoordinate2D] = []
        func collect(_ shapes: [MKShape & MKGeoJSONObject]) {
            for shape in shapes {
                switch shape {
                case let p as MKPolygon: polygons.append(p)
                case let l as MKPolyline: polylines.append(l)
                case let pt as MKPointAnnotation: points.append(pt.coordinate)
                default: break
                }
            }
        }
        for object in objects {
            if let shape = object as? (MKShape & MKGeoJSONObject) {
                collect([shape])
            } else if let feature = object as? MKGeoJSONFeature {
                collect(feature.geometry)
            }
        }
        return ZoneOverlay(
            id: zone.id,
            name: zone.name,
            color: ZonePalette.color(for: zone.zoneType),
            polygons: polygons,
            polylines: polylines,
            points: points
        )
    }
}

/// Shared MapContent for zone rendering (event map, pilot map, retriever map).
struct ZoneMapContent: MapContent {
    let overlays: [ZoneOverlay]

    var body: some MapContent {
        ForEach(overlays) { overlay in
            ForEach(Array(overlay.polygons.enumerated()), id: \.offset) { _, polygon in
                MapPolygon(polygon)
                    .foregroundStyle(overlay.color.opacity(0.15))
                    .stroke(overlay.color, lineWidth: 2)
            }
            ForEach(Array(overlay.polylines.enumerated()), id: \.offset) { _, line in
                MapPolyline(line)
                    .stroke(overlay.color, lineWidth: 2)
            }
            ForEach(Array(overlay.points.enumerated()), id: \.offset) { _, coord in
                Annotation(overlay.name, coordinate: coord) {
                    Circle()
                        .fill(overlay.color)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
        }
    }
}
