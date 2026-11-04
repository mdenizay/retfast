import Foundation
import Network

public struct NetworkStatus: Sendable, Equatable {
    public enum Interface: String, Sendable { case wifi, cellular, wired, other, none }
    public var isConnected: Bool
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interface: Interface

    public static let unknown = NetworkStatus(isConnected: true, isExpensive: false, isConstrained: false, interface: .other)
}

/// NWPathMonitor wrapper. "Connected" means a satisfied path exists, not that
/// the Retfast server is reachable — the sync engine still handles failures.
public final class NetworkMonitor: Sendable {
    public let updates = Broadcaster<NetworkStatus>(initial: .unknown)
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.mizibu.retfast.network")

    public init() {}

    public func start() {
        monitor.pathUpdateHandler = { [updates] path in
            let iface: NetworkStatus.Interface =
                path.usesInterfaceType(.wifi) ? .wifi :
                path.usesInterfaceType(.cellular) ? .cellular :
                path.usesInterfaceType(.wiredEthernet) ? .wired :
                path.status == .satisfied ? .other : .none
            updates.send(NetworkStatus(isConnected: path.status == .satisfied, isExpensive: path.isExpensive,
                                       isConstrained: path.isConstrained, interface: iface))
        }
        monitor.start(queue: queue)
    }

    public func cancel() { monitor.cancel() }
}
