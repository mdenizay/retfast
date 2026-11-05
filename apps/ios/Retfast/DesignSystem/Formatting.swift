import Foundation
import RetfastCore
import SwiftUI

enum Units: String, CaseIterable, Identifiable {
    case metric, imperial
    var id: String { rawValue }
    static var current: Units { Units(rawValue: UserDefaults.standard.string(forKey: "units") ?? "metric") ?? .metric }
}

enum FlightComputerTheme: String, CaseIterable, Identifiable {
    case auto, dark, light, highContrast
    var id: String { rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .auto: "Otomatik"
        case .dark: "Koyu"
        case .light: "Açık"
        case .highContrast: "Yüksek kontrast (güneş altı)"
        }
    }
}

enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var colorScheme: ColorScheme? { self == .light ? .light : (self == .dark ? .dark : nil) }
    var title: LocalizedStringKey {
        switch self {
        case .system: "Sistem"
        case .light: "Açık"
        case .dark: "Koyu"
        }
    }
}

/// Formatting helpers. "—" for unknown values: never show a fake zero.
enum Fmt {
    static let dash = "—"

    static func altitude(_ m: Double?) -> (String, String) {
        guard let m else { return (dash, Units.current == .metric ? "m" : "ft") }
        return Units.current == .metric ? (String(format: "%.0f", m), "m") : (String(format: "%.0f", m * 3.28084), "ft")
    }

    static func speed(_ ms: Double?) -> (String, String) {
        guard let ms else { return (dash, Units.current == .metric ? "km/h" : "mph") }
        return Units.current == .metric ? (String(format: "%.0f", ms * 3.6), "km/h") : (String(format: "%.0f", ms * 2.23694), "mph")
    }

    static func vario(_ ms: Double?) -> (String, String) {
        guard let ms else { return (dash, Units.current == .metric ? "m/s" : "ft/min") }
        if Units.current == .metric {
            let v = abs(ms) < 0.05 ? 0 : ms
            return (String(format: "%+.1f", v), "m/s")
        }
        return (String(format: "%+.0f", ms * 196.85), "ft/min")
    }

    static func distance(_ m: Double?) -> (String, String) {
        guard let m else { return (dash, Units.current == .metric ? "km" : "mi") }
        if Units.current == .metric { return m < 1000 ? (String(format: "%.0f", m), "m") : (String(format: "%.1f", m / 1000), "km") }
        return (String(format: "%.1f", m / 1609.34), "mi")
    }

    static func accuracy(_ m: Double?) -> String {
        guard let m, m >= 0 else { return dash }
        return Units.current == .metric ? String(format: "±%.0f m", m) : String(format: "±%.0f ft", m * 3.28084)
    }

    static func heading(_ deg: Double?) -> String {
        guard let deg else { return dash }
        return String(format: "%03.0f°", deg)
    }

    static func duration(_ s: TimeInterval) -> String {
        let total = Int(max(0, s))
        return String(format: "%d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    static func coordinate(_ lat: Double?, _ lon: Double?) -> String {
        guard let lat, let lon else { return dash }
        return String(format: "%.5f, %.5f", lat, lon)
    }

    static func age(_ s: TimeInterval) -> String {
        if s < 60 { return String(localized: "\(Int(s)) sn") }
        if s < 3600 { return String(localized: "\(Int(s / 60)) dk") }
        return String(localized: "\(Int(s / 3600)) sa")
    }

    static func time(_ d: Date?) -> String {
        guard let d else { return dash }
        return d.formatted(date: .omitted, time: .standard)
    }

    static func dateTime(_ d: Date?) -> String {
        guard let d else { return dash }
        return d.formatted(date: .abbreviated, time: .shortened)
    }

    static func relative(_ d: Date?) -> String {
        guard let d else { return dash }
        return d.formatted(.relative(presentation: .named))
    }

    static func battery(_ level: Double?) -> String {
        guard let level else { return dash }
        return "\(Int((level * 100).rounded()))%"
    }

    static func bytes(_ n: Int64) -> String { ByteCountFormatter.string(fromByteCount: n, countStyle: .file) }
}

extension TrackingProfile {
    var title: LocalizedStringKey {
        switch self {
        case .preFlight: "Kalkış öncesi"
        case .activeFlight: "Uçuş"
        case .thermal: "Termik"
        case .cruise: "Seyir"
        case .landing: "İniş"
        case .retrieveWaiting: "Retrieve bekleniyor"
        case .retrieverDriving: "Retrieve görevi"
        }
    }
}

extension FlightSessionState {
    var title: LocalizedStringKey {
        switch self {
        case .idle: "Kayıt yok"
        case .preparing: "GPS bekleniyor"
        case .recording: "Kaydediliyor"
        case .paused: "Duraklatıldı"
        case .ending: "Bitiriliyor"
        case .completed: "Tamamlandı"
        case .error: "Hata"
        }
    }
    var systemImage: String {
        switch self {
        case .idle: "circle"
        case .preparing: "location.magnifyingglass"
        case .recording: "record.circle"
        case .paused: "pause.circle"
        case .ending: "stop.circle"
        case .completed: "checkmark.circle"
        case .error: "exclamationmark.octagon"
        }
    }
    var tone: Tone {
        switch self {
        case .recording: .active
        case .preparing, .paused, .ending: .warning
        case .error: .error
        case .completed: .success
        case .idle: .neutral
        }
    }
}

extension LocationAuthorization.Status {
    var title: LocalizedStringKey {
        switch self {
        case .notDetermined: "Sorulmadı"
        case .restricted: "Kısıtlı"
        case .denied: "Reddedildi"
        case .whenInUse: "Kullanımdayken"
        case .always: "Her zaman"
        }
    }
}

extension Event {
    var statusTitle: LocalizedStringKey {
        switch status {
        case "active": "Aktif"
        case "published": "Yaklaşan"
        case "completed": "Tamamlandı"
        case "archived": "Arşivlendi"
        case "draft": "Taslak"
        default: LocalizedStringKey(status)
        }
    }
    var uuid: UUID? { UUID(uuidString: id) }
}

extension EventRole {
    var title: String {
        switch self {
        case .pilot: String(localized: "Pilot")
        case .observer: String(localized: "Gözlemci")
        case .retriever: String(localized: "Retriever")
        }
    }
    var systemImage: String {
        switch self {
        case .pilot: "paperplane.fill"
        case .observer: "eye.fill"
        case .retriever: "car.fill"
        }
    }
    var explanation: String {
        switch self {
        case .pilot: String(localized: "Uçar; uçuşu etkinlikte paylaşılır, inince retrieve ister.")
        case .observer: String(localized: "Canlı haritayı izler (çoğunlukla web).")
        case .retriever: String(localized: "İnen pilotları bulunduğu yerden alıp teslim eder.")
        }
    }
}

extension RetrievalStage {
    /// Short, logistics-style status (never "help is coming").
    var shortTitle: String {
        switch self {
        case .savedLocally: String(localized: "Telefona kaydedildi")
        case .sending: String(localized: "Gönderiliyor")
        case .requested: String(localized: "Retriever bekleniyor")
        case .accepted: String(localized: "Kabul edildi")
        case .pickedUp: String(localized: "Alındın")
        case .delivered: String(localized: "Teslim edildi")
        case .cancelling: String(localized: "İptal gönderiliyor")
        case .cancelled: String(localized: "İptal edildi")
        case .refused: String(localized: "Sunucu kabul etmedi")
        case .merged: String(localized: "Açık talebinle birleştirildi")
        }
    }
    var systemImage: String {
        switch self {
        case .savedLocally: "iphone"
        case .sending: "arrow.up.circle"
        case .requested: "hourglass"
        case .accepted: "car.fill"
        case .pickedUp: "figure.seated.side"
        case .delivered: "checkmark.circle.fill"
        case .cancelling, .cancelled: "xmark.circle"
        case .refused: "exclamationmark.octagon"
        case .merged: "arrow.triangle.merge"
        }
    }
    var tone: Tone {
        switch self {
        case .savedLocally, .sending, .cancelling: .warning
        case .requested: .info
        case .accepted, .pickedUp: .active
        case .delivered: .success
        case .cancelled, .merged: .neutral
        case .refused: .error
        }
    }
}

extension RetrievalStatus {
    var title: String {
        switch self {
        case .requested: String(localized: "Talep edildi")
        case .accepted: String(localized: "Kabul edildi")
        case .pickedUp: String(localized: "Alındı")
        case .delivered: String(localized: "Teslim edildi")
        case .cancelled: String(localized: "İptal edildi")
        }
    }
    var systemImage: String {
        switch self {
        case .requested: "hourglass"
        case .accepted: "car.fill"
        case .pickedUp: "figure.seated.side"
        case .delivered: "checkmark.circle.fill"
        case .cancelled: "xmark.circle"
        }
    }
    var tone: Tone {
        switch self {
        case .requested: .warning
        case .accepted: .info
        case .pickedUp: .active
        case .delivered: .success
        case .cancelled: .neutral
        }
    }
}

extension Fmt {
    /// Great-circle distance in metres.
    static func meters(_ a: (lat: Double, lon: Double), _ b: (lat: Double, lon: Double)) -> Double {
        let r = 6_371_000.0
        let dLat = (b.lat - a.lat) * .pi / 180, dLon = (b.lon - a.lon) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(min(1, sqrt(h)))
    }

    static func distanceText(_ m: Double?) -> String {
        guard let m else { return dash }
        let d = distance(m)
        return "\(d.0) \(d.1)"
    }
}
