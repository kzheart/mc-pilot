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
              "defaultProfile": "default"
            }
            """.utf8
        )

        let project = try XCTUnwrap(ProjectCatalog.loadProject(data: data))

        XCTAssertEqual(project.id, "-Users-kzheart-code-minecraft-RiftKey")
        XCTAssertEqual(project.name, "RiftKey")
        XCTAssertEqual(project.rootDir, "/Users/kzheart/code/minecraft/RiftKey")
        XCTAssertEqual(project.defaultProfile, "default")
    }
}
