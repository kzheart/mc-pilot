import XCTest
@testable import MCPilotConsole

final class MCTCommandTests: XCTestCase {
    func testUpCommandIncludesProfileWhenKnown() {
        XCTAssertEqual(MCTCommands.up(profile: "1.20").arguments, ["up", "--profile", "1.20"])
    }

    func testUpCommandOmitsUnknownProfile() {
        XCTAssertEqual(MCTCommands.up(profile: "Unknown").arguments, ["up"])
    }

    func testDisplayStringUsesMCTPrefix() {
        XCTAssertEqual(MCTCommands.serverStatus().displayString, "mct server status")
    }

    func testServerLifecycleCommandsIncludeOptionalName() {
        XCTAssertEqual(MCTCommands.serverStart("paper").arguments, ["server", "start", "paper"])
        XCTAssertEqual(MCTCommands.serverStop(nil).arguments, ["server", "stop"])
    }

    func testServerLogsIncludesTail() {
        XCTAssertEqual(MCTCommands.serverLogs("paper", tail: 50).arguments, ["server", "logs", "paper", "--tail", "50"])
        XCTAssertEqual(MCTCommands.serverLogs(nil, tail: 0).arguments, ["server", "logs", "--tail", "1"])
    }

    func testServerExecKeepsCommandTextTogether() {
        XCTAssertEqual(
            MCTCommands.serverExec("say hello world", server: "paper").arguments,
            ["server", "exec", "say hello world", "--server", "paper"]
        )
    }

    func testClientLifecycleCommands() {
        XCTAssertEqual(MCTCommands.clientLaunch("player-one").arguments, ["client", "launch", "player-one"])
        XCTAssertEqual(MCTCommands.clientLaunch(" ").arguments, ["client", "launch"])
        XCTAssertEqual(MCTCommands.clientStop("player-one").arguments, ["client", "stop", "player-one"])
    }
}
