import CoreLocation
import Foundation
import RetfastCore
import SwiftUI

enum RescueText {
    /// 403 means the server decided we may not see/do this — say so plainly.
    static func message(_ error: any Error) -> String {
        if let api = error as? APIError, api.status == 403, !api.isPasswordChangeRequired {
            return String(localized: "Bu işlem için kurtarma yetkiniz yok. Yetki sunucu tarafından belirlenir; gerekiyorsa platform yöneticisiyle iletişime geçin.")
        }
        return ErrorText.message(error)
    }
}

extension Incident {
    var isOpenUnacknowledged: Bool { status == "open" && acknowledgedAt == nil }
    var isActive: Bool { ["open", "acknowledged", "responding"].contains(status) }

    /// Best known coordinate: the SOS position, else last known flight position.
    var bestCoordinate: CLLocationCoordinate2D? {
        if let p = position { return CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon) }
        if let p = lastKnownPosition { return CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon) }
        return nil
    }

    var lastFixTime: Date? {
        [position?.t, lastKnownPosition?.receivedAt, lastKnownPosition?.t].compactMap { $0 }.max()
    }

    var pilotName: String { pilot?.fullName ?? pilot?.publicId ?? String(localized: "Bilinmeyen pilot") }

    /// Urgency: open & unacknowledged first, then acknowledged, then responding; oldest first within a group.
    static func urgencyOrder(_ a: Incident, _ b: Incident) -> Bool {
        func rank(_ i: Incident) -> Int {
            if i.isOpenUnacknowledged { return 0 }
            switch i.status {
            case "open", "acknowledged": return 1
            case "responding": return 2
            default: return 3
            }
        }
        let ra = rank(a), rb = rank(b)
        if ra != rb { return ra < rb }
        let ta = a.receivedAt ?? a.createdAtDevice ?? .distantFuture
        let tb = b.receivedAt ?? b.createdAtDevice ?? .distantFuture
        return ta < tb
    }
}

struct IncidentStatusPill: View {
    let incident: Incident
    var body: some View {
        switch incident.status {
        case "open" where incident.acknowledgedAt == nil:
            StatusPill(String(localized: "Açık · onaylanmadı"), systemImage: "sos.circle.fill", tone: .emergency)
        case "open", "acknowledged":
            StatusPill(String(localized: "Onaylandı"), systemImage: "checkmark.shield", tone: .warning)
        case "responding":
            StatusPill(String(localized: "Müdahale ediliyor"), systemImage: "figure.run", tone: .info)
        case "resolved":
            StatusPill(String(localized: "Çözüldü"), systemImage: "checkmark.circle", tone: .success)
        case "cancelled":
            StatusPill(String(localized: "İptal edildi"), systemImage: "xmark.circle", tone: .neutral)
        default:
            StatusPill(incident.status, systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

enum AssignmentStatus: String, CaseIterable {
    case assigned, enRoute = "en_route", onScene = "on_scene", completed, withdrawn

    var title: String {
        switch self {
        case .assigned: String(localized: "Atandı")
        case .enRoute: String(localized: "Yolda")
        case .onScene: String(localized: "Olay yerinde")
        case .completed: String(localized: "Tamamlandı")
        case .withdrawn: String(localized: "Geri çekildi")
        }
    }

    var systemImage: String {
        switch self {
        case .assigned: "person.badge.clock"
        case .enRoute: "car"
        case .onScene: "mappin.and.ellipse"
        case .completed: "checkmark.circle"
        case .withdrawn: "arrow.uturn.left"
        }
    }

    var next: AssignmentStatus? {
        switch self {
        case .assigned: .enRoute
        case .enRoute: .onScene
        case .onScene: .completed
        case .completed, .withdrawn: nil
        }
    }
}

struct AssignmentStatusPill: View {
    let status: String
    var body: some View {
        if let s = AssignmentStatus(rawValue: status) {
            StatusPill(s.title, systemImage: s.systemImage, tone: s == .completed ? .success : (s == .withdrawn ? .neutral : .info))
        } else {
            StatusPill(status, systemImage: "questionmark.circle")
        }
    }
}

enum AppleMaps {
    /// Opens Apple Maps with driving directions to the coordinate.
    static func directionsURL(to c: CLLocationCoordinate2D, name: String) -> URL? {
        var comps = URLComponents(string: "https://maps.apple.com/")
        comps?.queryItems = [
            URLQueryItem(name: "daddr", value: String(format: "%.6f,%.6f", c.latitude, c.longitude)),
            URLQueryItem(name: "dirflg", value: "d"),
            URLQueryItem(name: "q", value: name),
        ]
        return comps?.url
    }
}
