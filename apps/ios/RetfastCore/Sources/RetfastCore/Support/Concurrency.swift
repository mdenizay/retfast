import Foundation

/// Fan-out of values to any number of `AsyncStream` subscribers. Late
/// subscribers immediately receive the latest value.
public final class Broadcaster<Value: Sendable>: Sendable {
    private struct State {
        var continuations: [UUID: AsyncStream<Value>.Continuation] = [:]
        var latest: Value?
    }
    private let state = LockedBox(State())

    public init(initial: Value? = nil) {
        state.withLock { $0.latest = initial }
    }

    public var latest: Value? { state.withLock { $0.latest } }

    public func stream() -> AsyncStream<Value> {
        AsyncStream { continuation in
            let id = UUID()
            let latest = state.withLock { s -> Value? in
                s.continuations[id] = continuation
                return s.latest
            }
            if let latest { continuation.yield(latest) }
            continuation.onTermination = { [weak self] _ in
                self?.state.withLock { _ = $0.continuations.removeValue(forKey: id) }
            }
        }
    }

    public func send(_ value: Value) {
        let targets = state.withLock { s -> [AsyncStream<Value>.Continuation] in
            s.latest = value
            return Array(s.continuations.values)
        }
        for c in targets { c.yield(value) }
    }
}

/// Minimal lock-protected box (Synchronization.Mutex requires iOS 18, we target 17).
public final class LockedBox<Value>: @unchecked Sendable {
    private var value: Value
    private let lock = NSLock()
    public init(_ value: Value) { self.value = value }
    public func withLock<R>(_ body: (inout Value) throws -> R) rethrows -> R {
        lock.lock()
        defer { lock.unlock() }
        return try body(&value)
    }
}

/// Injected time source so retry/backoff and polling are deterministic in tests.
public protocol SyncClock: Sendable {
    func now() -> Date
    func sleep(seconds: Double) async throws
}

public struct SystemClock: SyncClock {
    public init() {}
    public func now() -> Date { Date() }
    public func sleep(seconds: Double) async throws {
        try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
    }
}

/// Exponential backoff with jitter: delay = min(cap, base·2^attempt) scaled into
/// [0.5, 1.0] by the jitter source ("equal jitter"), so retries never collapse
/// to zero and never synchronise across devices.
public struct Backoff: Sendable {
    public var base: Double
    public var cap: Double
    public var jitter: @Sendable () -> Double

    public init(base: Double = 2, cap: Double = 120, jitter: @escaping @Sendable () -> Double = { Double.random(in: 0...1) }) {
        self.base = base
        self.cap = cap
        self.jitter = jitter
    }

    /// `attempt` is 0 for the first retry.
    public func delay(attempt: Int) -> Double {
        let exp = min(cap, base * pow(2, Double(min(attempt, 30))))
        let j = min(1, max(0, jitter()))
        return exp * (0.5 + 0.5 * j)
    }
}
