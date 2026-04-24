import XCTest
@testable import MCPilotConsole

final class ShellWordsTests: XCTestCase {
    func testSplitKeepsQuotedArgumentTogether() {
        XCTAssertEqual(
            ShellWords.split(#"chat command "gamemode creative""#),
            ["chat", "command", "gamemode creative"]
        )
    }

    func testSplitSupportsSingleQuotes() {
        XCTAssertEqual(
            ShellWords.split("chat send 'hello world'"),
            ["chat", "send", "hello world"]
        )
    }
}
