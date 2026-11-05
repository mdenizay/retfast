import SwiftUI

// Lucide icons (ISC licence, lucide.dev) bundled as custom SF Symbols under
// Assets.xcassets/Lucide, so they scale with the font like system symbols.
// Call sites keep SF Symbol names; `Icons.lucide` maps them, anything
// unmapped falls back to the system symbol.

enum Icons {
    static let lucide: [String: String] = [
        "checkmark.circle.fill": "circle-check",
        "checkmark.circle": "circle-check",
        "checkmark": "check",
        "checkmark.seal": "badge-check",
        "car.fill": "car",
        "arrow.up.right": "arrow-up-right",
        "car": "car",
        "xmark.circle": "circle-x",
        "xmark.circle.fill": "circle-x",
        "xmark": "x",
        "questionmark.circle": "circle-help",
        "questionmark": "circle-help",
        "paperplane.fill": "navigation-2",
        "paperplane": "navigation-2",
        "location.magnifyingglass": "locate",
        "icloud.and.arrow.up": "cloud-upload",
        "checkmark.icloud": "cloud",
        "exclamationmark.icloud": "cloud-alert",
        "arrow.triangle.2.circlepath.icloud": "refresh-cw",
        "icloud.slash": "cloud-off",
        "figure.seated.side": "armchair",
        "dot.radiowaves.left.and.right": "radio",
        "text.bubble": "message-square-text",
        "star.fill": "star",
        "square.and.arrow.up": "share",
        "square.and.arrow.down": "download",
        "phone.fill": "phone",
        "location.slash": "locate-off",
        "location.fill": "locate-fixed",
        "location": "locate",
        "location.circle": "locate",
        "location.north.line.fill": "navigation",
        "location.north.circle": "compass",
        "location.fill.viewfinder": "scan",
        "hand.raised": "hand",
        "hand.raised.fill": "hand",
        "exclamationmark.octagon": "octagon-alert",
        "clock": "clock",
        "clock.badge.exclamationmark": "clock-alert",
        "arrow.left": "arrow-left",
        "arrow.right": "arrow-right",
        "tray.full": "inbox",
        "tray": "inbox",
        "stop.circle": "circle-stop",
        "stop.fill": "square",
        "record.circle": "circle-dot",
        "point.topleft.down.to.point.bottomright.curvepath": "route",
        "person.crop.circle": "circle-user",
        "person.crop.circle.badge.exclamationmark": "user-x",
        "pause.circle": "circle-pause",
        "pause.fill": "pause",
        "play.fill": "play",
        "chevron.down": "chevron-down",
        "chevron.up": "chevron-up",
        "chevron.right": "chevron-right",
        "calendar": "calendar",
        "arrow.up.circle": "circle-arrow-up",
        "arrow.up.circle.fill": "circle-arrow-up",
        "arrow.down.circle.fill": "circle-arrow-down",
        "arrow.triangle.2.circlepath": "refresh-cw",
        "antenna.radiowaves.left.and.right.slash": "wifi-off",
        "wifi.slash": "wifi-off",
        "testtube.2": "flask-conical",
        "stethoscope": "stethoscope",
        "scope": "crosshair",
        "person.3": "users",
        "person.3.fill": "users",
        "person.2": "users",
        "person.badge.plus": "user-plus",
        "person.badge.key": "key-round",
        "pencil": "pencil",
        "mappin.slash": "map-pin-off",
        "mappin.circle.fill": "map-pin",
        "mappin.and.ellipse": "map-pin",
        "map": "map",
        "lock": "lock",
        "lock.rotation": "lock-keyhole",
        "key": "key-round",
        "iphone": "smartphone",
        "iphone.and.arrow.forward": "smartphone",
        "info.circle": "info",
        "flag.fill": "flag",
        "flag.2.crossed": "flag",
        "figure.walk": "footprints",
        "eye.fill": "eye",
        "exclamationmark.triangle": "triangle-alert",
        "exclamationmark.triangle.fill": "triangle-alert",
        "exclamationmark.shield.fill": "shield-alert",
        "exclamationmark.circle.fill": "circle-alert",
        "bolt.slash": "zap-off",
        "bolt.horizontal.circle": "zap",
        "bolt.horizontal.circle.fill": "zap-off",
        "bell.slash": "bell-off",
        "bell.fill": "bell",
        "bell": "bell",
        "arrow.uturn.left": "undo-2",
        "arrow.up.right.circle": "mountain",
        "arrow.triangle.turn.up.right.diamond.fill": "navigation",
        "arrow.triangle.merge": "merge",
        "arrow.down.to.line": "arrow-down-to-line",
        "arrow.clockwise": "rotate-cw",
        "archivebox": "archive",
        "hourglass": "hourglass",
        "circle": "circle",
        "sos": "siren",
        "siren": "siren",
        "globe": "globe",
        "gearshape": "settings",
        "rectangle.portrait.and.arrow.right": "log-out",
        "person.fill": "user",
        "mountain.2": "mountain",
        "wind": "wind",
        "gauge": "gauge",
        "timer": "timer",
        "arrow.up": "arrow-up",
        "arrow.down": "arrow-down",
        "plus": "plus",
        "minus": "minus",
        "ellipsis": "ellipsis",
        "envelope": "mail",
        "sun.max": "sun",
        "moon": "moon",
        "circle.lefthalf.filled": "sun-moon",
        "thermometer": "thermometer",
        "cloud": "cloud",
        "play": "play",
        "pause": "pause",
        "backward.fill": "rewind",
        "forward.fill": "fast-forward",
        "chart.bar": "chart-column",
        "trophy": "trophy",
        "user": "user",
        "line.3.horizontal": "menu",
        "magnifyingglass": "search",
    ]

    static func assetName(_ systemName: String) -> String? {
        lucide[systemName].map { "Lucide/\($0)" }
    }
}

extension Image {
    /// Lucide icon for an SF Symbol name (falls back to the SF Symbol).
    init(icon name: String) {
        if let asset = Icons.assetName(name) { self.init(asset) } else { self.init(systemName: name) }
    }
}

extension Label where Title == Text, Icon == Image {
    init(_ titleKey: LocalizedStringKey, icon: String) {
        self.init { Text(titleKey) } icon: { Image(icon: icon) }
    }

    @_disfavoredOverload
    init<S: StringProtocol>(_ title: S, icon: String) {
        self.init { Text(title) } icon: { Image(icon: icon) }
    }
}
