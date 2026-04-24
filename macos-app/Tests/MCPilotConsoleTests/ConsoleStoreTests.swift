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

private final class RecordingMCTClient: MCTClient {
    var commands: [String] = []
    var responses: [String: CommandResult]

    init(responses: [String: CommandResult]) {
        self.responses = responses
    }

    func run(_ command: MCTCommand, workingDirectory: URL) async -> CommandResult {
        commands.append(command.displayString)
        return responses[command.displayString] ?? CommandResult(
            command: command.displayString,
            exitCode: 0,
            stdout: "",
            stderr: "",
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
                        stdout: #"{"success":true,"data":{"project":"ShopPlugin","projectId":"shop","activeProfile":"1.20","projectRootDir":"/tmp/shop"}}"#,
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

    func testRefreshKeepsUnknownForNullProjectFields() async throws {
        let now = Date()
        let store = ConsoleStore(
            client: FakeMCTClient(
                responses: [
                    "mct info": CommandResult(
                        command: "mct info",
                        exitCode: 0,
                        stdout: #"{"success":true,"data":{"project":null,"projectId":null,"activeProfile":null,"projectRootDir":null}}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    ),
                    "mct server status": CommandResult(
                        command: "mct server status",
                        exitCode: 0,
                        stdout: #"{"success":true,"data":[]}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    ),
                    "mct client list": CommandResult(
                        command: "mct client list",
                        exitCode: 0,
                        stdout: #"{"success":true,"data":{"clients":[]}}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    )
                ]
            )
        )

        store.refresh()
        try await waitUntilIdle(store)

        XCTAssertEqual(store.status.projectName, "Unknown")
        XCTAssertEqual(store.status.projectId, "Unknown")
        XCTAssertEqual(store.status.activeProfile, "Unknown")
        XCTAssertEqual(store.status.projectRootDir, "")
    }

    func testRefreshIgnoresObjectActiveProfile() async throws {
        let now = Date()
        let store = ConsoleStore(
            client: FakeMCTClient(
                responses: [
                    "mct info": CommandResult(
                        command: "mct info",
                        exitCode: 0,
                        stdout: #"{"success":true,"data":{"project":"RiftKey","projectId":"rift","activeProfile":{"server":"paper"},"projectRootDir":"/tmp/rift"}}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    ),
                    "mct server status": CommandResult(
                        command: "mct server status",
                        exitCode: 0,
                        stdout: #"{"success":true,"data":[]}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    ),
                    "mct client list": CommandResult(
                        command: "mct client list",
                        exitCode: 0,
                        stdout: #"{"success":true,"data":{"clients":[]}}"#,
                        stderr: "",
                        startedAt: now,
                        finishedAt: now
                    )
                ]
            )
        )

        store.refresh()
        try await waitUntilIdle(store)

        XCTAssertEqual(store.status.projectName, "RiftKey")
        XCTAssertEqual(store.status.activeProfile, "Unknown")
    }

    func testSelectProjectSetsRuntimeTargets() async throws {
        let project = makeProject()
        let client = RecordingMCTClient(responses: emptyRefreshResponses())
        let store = ConsoleStore(client: client, projects: [project])

        store.selectProject(project)
        try await waitUntilIdle(store)

        XCTAssertEqual(store.currentServerName, "paper")
        XCTAssertEqual(store.currentClientNames, ["player-one", "player-two"])
        XCTAssertEqual(store.status.activeProfile, "default")
        XCTAssertEqual(client.commands, ["mct info", "mct server status", "mct client list"])
    }

    func testStartServerRefreshesLogs() async throws {
        let project = makeProject()
        let now = Date()
        let client = RecordingMCTClient(
            responses: [
                "mct server start paper": CommandResult(
                    command: "mct server start paper",
                    exitCode: 0,
                    stdout: #"{"started":true}"#,
                    stderr: "",
                    startedAt: now,
                    finishedAt: now
                ),
                "mct server logs paper --tail 120": CommandResult(
                    command: "mct server logs paper --tail 120",
                    exitCode: 0,
                    stdout: "[Server thread/INFO]: Done",
                    stderr: "",
                    startedAt: now,
                    finishedAt: now
                )
            ]
        )
        let store = ConsoleStore(client: client, projects: [project])
        store.selectedProjectId = project.id

        store.startServer()
        try await waitUntilIdle(store)

        XCTAssertEqual(client.commands, ["mct server start paper", "mct server logs paper --tail 120"])
        XCTAssertEqual(store.serverLog, "[Server thread/INFO]: Done")
        XCTAssertEqual(store.status.state, .ready)
    }

    func testSendServerCommandUsesCurrentServerAndRefreshesLogs() async throws {
        let project = makeProject()
        let now = Date()
        let client = RecordingMCTClient(
            responses: [
                "mct server exec say hello --server paper": CommandResult(
                    command: "mct server exec say hello --server paper",
                    exitCode: 0,
                    stdout: #"{"sent":true}"#,
                    stderr: "",
                    startedAt: now,
                    finishedAt: now
                ),
                "mct server logs paper --tail 120": CommandResult(
                    command: "mct server logs paper --tail 120",
                    exitCode: 0,
                    stdout: "hello",
                    stderr: "",
                    startedAt: now,
                    finishedAt: now
                )
            ]
        )
        let store = ConsoleStore(client: client, projects: [project])
        store.selectedProjectId = project.id

        store.sendServerCommand(" say hello ")
        try await waitUntilIdle(store)

        XCTAssertEqual(client.commands, ["mct server exec say hello --server paper", "mct server logs paper --tail 120"])
        XCTAssertEqual(store.serverLog, "hello")
    }

    func testLaunchAndStopClientUseNamedClient() async throws {
        let client = RecordingMCTClient(responses: [:])
        let store = ConsoleStore(client: client, projects: [])

        store.launchClient("player-one")
        try await waitUntilIdle(store)
        store.stopClient("player-one")
        try await waitUntilIdle(store)

        XCTAssertEqual(client.commands, ["mct client launch player-one", "mct client stop player-one"])
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

    private func makeProject() -> MCTProject {
        MCTProject(
            id: "rift",
            name: "Rift",
            rootDir: "/tmp/rift",
            defaultProfile: "default",
            activeProfile: MCTProjectProfile(name: "default", server: "paper", clients: ["player-one", "player-two"])
        )
    }

    private func emptyRefreshResponses() -> [String: CommandResult] {
        let now = Date()
        return [
            "mct info": CommandResult(
                command: "mct info",
                exitCode: 0,
                stdout: #"{"success":true,"data":{"project":"Rift","projectId":"rift","activeProfile":"default","projectRootDir":"/tmp/rift"}}"#,
                stderr: "",
                startedAt: now,
                finishedAt: now
            ),
            "mct server status": CommandResult(
                command: "mct server status",
                exitCode: 0,
                stdout: #"{"success":true,"data":[]}"#,
                stderr: "",
                startedAt: now,
                finishedAt: now
            ),
            "mct client list": CommandResult(
                command: "mct client list",
                exitCode: 0,
                stdout: #"{"success":true,"data":{"clients":[]}}"#,
                stderr: "",
                startedAt: now,
                finishedAt: now
            )
        ]
    }
}
