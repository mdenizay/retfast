import Foundation

/// Pure transition table for the flight session lifecycle.
///
///     idle ──start──▶ preparing ──firstFix──▶ recording ◀──resume── paused
///                         │                     │   └──pause──▶ ┘    │
///                         └────────end──────────┴──────end───────────┘
///                                               ▼
///                                            ending ──ended──▶ completed ──reset──▶ idle
///     any active ──fail──▶ error ──reset──▶ idle   (error ──resume──▶ recording, ──end──▶ ending)
///     idle ──restore(s)──▶ s   (relaunch with a persisted active session)
public struct FlightSessionStateMachine: Sendable, Equatable {
    public enum Event: Sendable, Equatable {
        case start
        case firstFix
        case pause
        case resume
        case end
        case ended
        case fail(String)
        case reset
        case restore(FlightSessionState)
    }

    public struct InvalidTransition: Error, Equatable {
        public let from: FlightSessionState
        public let event: Event
    }

    public private(set) var state: FlightSessionState

    public init(state: FlightSessionState = .idle) { self.state = state }

    public static func next(_ state: FlightSessionState, _ event: Event) -> FlightSessionState? {
        switch (state, event) {
        case (.idle, .start), (.completed, .start), (.error, .start): .preparing
        case (.idle, .restore(let s)) where s.isActive: s
        case (.preparing, .firstFix), (.recording, .firstFix): .recording
        case (.recording, .pause): .paused
        case (.paused, .resume), (.error, .resume): .recording
        case (.preparing, .end), (.recording, .end), (.paused, .end), (.error, .end): .ending
        case (.ending, .ended): .completed
        case (.preparing, .fail), (.recording, .fail), (.paused, .fail), (.ending, .fail): .error
        case (.completed, .reset), (.error, .reset), (.idle, .reset): .idle
        default: nil
        }
    }

    @discardableResult
    public mutating func handle(_ event: Event) throws -> FlightSessionState {
        guard let next = Self.next(state, event) else { throw InvalidTransition(from: state, event: event) }
        state = next
        return next
    }
}
