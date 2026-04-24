import Foundation
import XCTest
@testable import MCPilotConsole

private struct FakeMCTClient: MCTClient {
    let responses: [String: CommandResult]

    func run(_ command: MCTCommand, workingDirectory: URL) async -> CommandResult {
        responses[command.displayString] ?? CommandResult(
            command: command.displayString,
            exitCode: 1,
            stdout: "",
            stderr: "missing fake response",
            startedAt: Date(),
            finishedAt: Date()
        )
    }
}

@MainActor
final class ConsoleStoreTests: XCTestCase {
    func testRefreshAppliesInfoAndReadyState() async throws {
        let now = Date()
        let store = ConsoleStore(
            client: FakeMCTClient(
                responses: [
                    "mct info": CommandResult(
                        command: "mct info",
                        exitCode: 0,
                        stdout: #"{"project":"ShopPlugin","projectId":"shop","activeProfile":"1.20","projectRootDir":"/tmp/shop"}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    ),
                    "mct server status": CommandResult(
                        command: "mct server status",
                        exitCode: 0,
                        stdout: #"{"status":"running"}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    ),
                    "mct client list": CommandResult(
                        command: "mct client list",
                        exitCode: 0,
                        stdout: #"[]"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    )
                ]
            )
        )

        store.refresh()
        try await waitUntilIdle(store)

        XCTAssertEqual(store.status.projectName, "ShopPlugin")
        XCTAssertEqual(store.status.activeProfile, "1.20")
        XCTAssertEqual(store.status.state, .ready)
        XCTAssertEqual(store.history.count, 3)
    }

    private func waitUntilIdle(_ store: ConsoleStore) async throws {
        for _ in 0..<20 {
            if !store.isRunning {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("store did not finish running")
    }
}
