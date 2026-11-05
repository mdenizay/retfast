import Foundation

/// Member role inside one event (api-contract.md "Roles and the event workflow").
/// `organizer` is a separate flag (`Event.me.is_organizer`) that may be combined
/// with any member role.
public enum EventRole: String, Codable, Sendable, CaseIterable, Identifiable {
    case pilot
    case observer
    case retriever

    public var id: String { rawValue }
}

/// Application state shown to a non-member (`Event.me.application`).
public enum ApplicationState: Sendable, Equatable {
    /// No application, applications open: show the Apply form.
    case canApply
    /// No application, applications closed.
    case closed
    case pending(id: String)
    /// Rejected or withdrawn; may apply again when applications are open.
    case rejected(id: String, canReapply: Bool)
    case withdrawn(id: String, canReapply: Bool)
}

/// Which bottom sheet the event screen shows. Pure function of the event, so
/// it is unit-tested and the server stays the authority on roles.
public enum EventSheetMode: Sendable, Equatable {
    case notMember(ApplicationState)
    case pilot
    case retriever
    case observer
    /// Organizer without a member role: read-only event overview plus the
    /// organizer tools (applications inbox, members).
    case organizerOnly

    public static func mode(for event: Event) -> EventSheetMode {
        switch event.memberRole {
        case .pilot: return .pilot
        case .retriever: return .retriever
        case .observer: return .observer
        case nil:
            if event.isOrganizer { return .organizerOnly }
            return .notMember(applicationState(event))
        }
    }

    static func applicationState(_ event: Event) -> ApplicationState {
        let open = event.settings?.applicationsOpen ?? false
        guard let app = event.me?.application else { return open ? .canApply : .closed }
        switch app.status {
        case "pending": return .pending(id: app.id)
        case "rejected": return .rejected(id: app.id, canReapply: open)
        case "withdrawn": return .withdrawn(id: app.id, canReapply: open)
        // "approved" without a role means the membership was removed afterwards.
        default: return open ? .canApply : .closed
        }
    }

    /// Organizer tools are shown in addition to the member sheet.
    public static func showsOrganizerTools(_ event: Event) -> Bool { event.isOrganizer }

    /// Whether the map may show other pilots' live positions. The server
    /// filters anyway; this only avoids an empty, confusing layer.
    public static func showsPilotLayer(_ event: Event) -> Bool {
        if event.isOrganizer { return true }
        switch event.memberRole {
        case .observer: return true
        case .pilot: return true  // own flight always; others when pilots_see_each_other
        case .retriever: return false
        case nil: return event.settings?.publicLiveMap ?? false
        }
    }
}
