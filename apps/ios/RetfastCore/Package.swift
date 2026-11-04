// swift-tools-version:6.0
// RetfastCore: domain, tracking engine, local storage, sync and networking.
// Kept as a local package so `swift test` runs the engine tests on the host
// without a simulator. The app target links it through apps/ios/project.yml.
import PackageDescription

let package = Package(
    name: "RetfastCore",
    defaultLocalization: "tr",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RetfastCore", targets: ["RetfastCore"]),
    ],
    dependencies: [
        // 7.x is the current major; 7.12 supports iOS 13+ (we target 17).
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.12.0"),
    ],
    targets: [
        .target(
            name: "RetfastCore",
            dependencies: [.product(name: "GRDB", package: "GRDB.swift")],
            swiftSettings: [.enableUpcomingFeature("ExistentialAny")]
        ),
        .testTarget(
            name: "RetfastCoreTests",
            dependencies: ["RetfastCore"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
