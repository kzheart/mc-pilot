import XCTest
@testable import MCPilotConsole

final class ProjectCatalogTests: XCTestCase {
    func testLoadProjectFromConfigData() throws {
        let data = Data(
            """
            {
              "projectId": "-Users-kzheart-code-minecraft-RiftKey",
              "project": "RiftKey",
              "rootDir": "/Users/kzheart/code/minecraft/RiftKey",
              "defaultProfile": "default",
              "profiles": {
                "default": {
                  "server": "paper",
                  "clients": ["player-one", "player-two"]
                }
              }
            }
            """.utf8
        )

        let project = try XCTUnwrap(ProjectCatalog.loadProject(data: data))

        XCTAssertEqual(project.id, "-Users-kzheart-code-minecraft-RiftKey")
        XCTAssertEqual(project.name, "RiftKey")
        XCTAssertEqual(project.rootDir, "/Users/kzheart/code/minecraft/RiftKey")
        XCTAssertEqual(project.defaultProfile, "default")
        XCTAssertEqual(project.activeProfile?.name, "default")
        XCTAssertEqual(project.activeProfile?.server, "paper")
        XCTAssertEqual(project.activeProfile?.clients, ["player-one", "player-two"])
    }

    func testLoadProjectWithoutDefaultProfileTarget() throws {
        let data = Data(
            """
            {
              "projectId": "empty",
              "project": "Empty",
              "rootDir": "/tmp/empty",
              "profiles": {}
            }
            """.utf8
        )

        let project = try XCTUnwrap(ProjectCatalog.loadProject(data: data))

        XCTAssertEqual(project.defaultProfile, "")
        XCTAssertNil(project.activeProfile)
    }
}
