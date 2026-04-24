// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "MCPilotConsole",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "MCPilotConsole", targets: ["MCPilotConsole"])
    ],
    targets: [
        .executableTarget(
            name: "MCPilotConsole",
            path: "Sources/MCPilotConsole"
        ),
        .testTarget(
            name: "MCPilotConsoleTests",
            dependencies: ["MCPilotConsole"],
            path: "Tests/MCPilotConsoleTests"
        )
    ]
)
