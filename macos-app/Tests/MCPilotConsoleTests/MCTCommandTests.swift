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
}
