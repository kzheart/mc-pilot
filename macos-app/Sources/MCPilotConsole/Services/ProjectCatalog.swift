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
        let activeProfile = loadActiveProfile(
            name: defaultProfile,
            profiles: json["profiles"] as? [String: Any]
        )

        return MCTProject(
            id: projectId,
            name: name,
            rootDir: rootDir,
            defaultProfile: defaultProfile,
            activeProfile: activeProfile
        )
    }

    private static func loadActiveProfile(name: String, profiles: [String: Any]?) -> MCTProjectProfile? {
        guard !name.isEmpty,
              let profile = profiles?[name] as? [String: Any],
              let server = profile["server"] as? String,
              !server.isEmpty else {
            return nil
        }

        let clients = (profile["clients"] as? [Any])?
            .compactMap { $0 as? String }
            .filter { !$0.isEmpty } ?? []

        return MCTProjectProfile(name: name, server: server, clients: clients)
    }
}
