import Foundation

enum ProjectCatalog {
    static func loadProjects() -> [MCTProject] {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".mct")
            .appendingPathComponent("projects")

        guard let projectDirs = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil
        ) else {
            return []
        }

        return projectDirs.compactMap { dir in
            loadProject(from: dir.appendingPathComponent("project.json"))
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private static func loadProject(from url: URL) -> MCTProject? {
        loadProject(data: try? Data(contentsOf: url))
    }

    static func loadProject(data: Data?) -> MCTProject? {
        guard let data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let projectId = json["projectId"] as? String,
              let rootDir = json["rootDir"] as? String else {
            return nil
        }

        let name = (json["project"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? projectId
        let defaultProfile = json["defaultProfile"] as? String ?? ""

        return MCTProject(
            id: projectId,
            name: name,
            rootDir: rootDir,
            defaultProfile: defaultProfile
        )
    }
}
