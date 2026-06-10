// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MctRecorder",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "mct-recorder", targets: ["MctRecorder"])
    ],
    targets: [
        .executableTarget(
            name: "MctRecorder",
            path: "Sources/MctRecorder"
        )
    ]
)
