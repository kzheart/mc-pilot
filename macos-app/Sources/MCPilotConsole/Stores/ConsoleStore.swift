import Foundation

@MainActor
final class ConsoleStore: ObservableObject {
    @Published var workingDirectory: String
    @Published private(set) var projects: [MCTProject] = []
    @Published var selectedProjectId: String?
    @Published private(set) var status = EnvironmentStatus()
    @Published private(set) var history: [CommandResult] = []
    @Published private(set) var serverLog = ""
    @Published private(set) var isRunning = false

    private let client: MCTClient

    init(client: MCTClient = ProcessMCTClient(), projects initialProjects: [MCTProject]? = nil) {
        self.client = client
        self.workingDirectory = Self.defaultWorkingDirectory()
        if let initialProjects {
            projects = initialProjects
        } else {
            reloadProjects()
        }
    }

    func reloadProjects() {
        projects = ProjectCatalog.loadProjects()
        if selectedProjectId == nil {
            selectedProjectId = projects.first(where: { $0.rootDir == workingDirectory })?.id
        }
    }

    func selectProject(_ project: MCTProject) {
        selectedProjectId = project.id
        workingDirectory = project.rootDir
        status.projectName = project.name
        status.projectId = project.id
        status.activeProfile = project.activeProfile?.name ?? (project.defaultProfile.isEmpty ? "Unknown" : project.defaultProfile)
        status.projectRootDir = project.rootDir
        serverLog = ""
        refresh()
    }

    func refresh() {
        runTask {
            self.status.state = .loading
            let info = await self.runAndRecord(MCTCommands.info())
            let server = await self.runAndRecord(MCTCommands.serverStatus())
            let clients = await self.runAndRecord(MCTCommands.clientList())

            self.applyInfo(info)
            self.status.serverSummary = self.summary(for: server)
            self.status.clientSummary = self.summary(for: clients)
            self.status.lastUpdated = Date()
            self.status.state = [info, server, clients].allSatisfy(\.succeeded) ? .ready : .warning
        }
    }

    func startCurrentProfile() {
        runTask {
            self.status.state = .loading
            let result = await self.runAndRecord(MCTCommands.up(profile: self.status.activeProfile))
            self.status.state = result.succeeded ? .ready : .failed
            self.status.lastUpdated = Date()
        }
    }

    func stopAll() {
        runTask {
            self.status.state = .loading
            let result = await self.runAndRecord(MCTCommands.down())
            self.status.state = result.succeeded ? .idle : .failed
            self.status.lastUpdated = Date()
        }
    }

    func takeScreenshot() {
        runTask {
            let result = await self.runAndRecord(MCTCommands.screenshot())
            self.status.state = result.succeeded ? self.status.state : .failed
            self.status.lastUpdated = Date()
        }
    }

    func startServer() {
        runTask {
            self.status.state = .loading
            let result = await self.runAndRecord(MCTCommands.serverStart(self.currentServerName))
            self.status.state = result.succeeded ? .ready : .failed
            self.status.lastUpdated = Date()
            await self.refreshServerLogsInCurrentTask()
        }
    }

    func stopServer() {
        runTask {
            self.status.state = .loading
            let result = await self.runAndRecord(MCTCommands.serverStop(self.currentServerName))
            self.status.state = result.succeeded ? .idle : .failed
            self.status.lastUpdated = Date()
            await self.refreshServerLogsInCurrentTask()
        }
    }

    func launchClient(_ name: String) {
        runTask {
            let result = await self.runAndRecord(MCTCommands.clientLaunch(name))
            self.status.state = result.succeeded ? self.status.state : .failed
            self.status.lastUpdated = Date()
        }
    }

    func stopClient(_ name: String) {
        runTask {
            let result = await self.runAndRecord(MCTCommands.clientStop(name))
            self.status.state = result.succeeded ? self.status.state : .failed
            self.status.lastUpdated = Date()
        }
    }

    func refreshServerLogs() {
        runTask {
            await self.refreshServerLogsInCurrentTask()
        }
    }

    func sendServerCommand(_ command: String) {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        runTask {
            let result = await self.runAndRecord(MCTCommands.serverExec(trimmed, server: self.currentServerName))
            self.status.state = result.succeeded ? self.status.state : .failed
            self.status.lastUpdated = Date()
            await self.refreshServerLogsInCurrentTask()
        }
    }

    func runCustom(arguments: String) {
        let parts = ShellWords.split(arguments)
        guard !parts.isEmpty else { return }
        runTask {
            _ = await self.runAndRecord(MCTCommand(arguments: parts))
            self.status.lastUpdated = Date()
        }
    }

    private func runTask(_ action: @escaping () async -> Void) {
        guard !isRunning else { return }
        isRunning = true
        Task {
            await action()
            self.isRunning = false
        }
    }

    private func runAndRecord(_ command: MCTCommand) async -> CommandResult {
        let result = await client.run(command, workingDirectory: workingDirectoryURL)
        history.insert(result, at: 0)
        history = Array(history.prefix(20))
        return result
    }

    private func refreshServerLogsInCurrentTask() async {
        let result = await runAndRecord(MCTCommands.serverLogs(currentServerName))
        serverLog = result.displayOutput
        status.serverSummary = summary(for: result)
        status.lastUpdated = Date()
    }

    private func applyInfo(_ result: CommandResult) {
        guard result.succeeded,
              let data = result.stdout.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        let json = (raw["data"] as? [String: Any]) ?? raw
        status.projectName = stringValue(json["project"]) ?? status.projectName
        status.projectId = stringValue(json["projectId"]) ?? status.projectId
        status.activeProfile = stringValue(json["activeProfile"]) ?? status.activeProfile
        status.projectRootDir = stringValue(json["projectRootDir"]) ?? status.projectRootDir
    }

    private func summary(for result: CommandResult) -> String {
        if result.succeeded {
            let text = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? "OK" : text
        }

        let text = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "Command failed" : text
    }

    private func stringValue(_ value: Any?) -> String? {
        guard let value else { return nil }
        if value is NSNull {
            return nil
        }
        if let string = value as? String {
            return string.isEmpty ? nil : string
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        return nil
    }

    private var workingDirectoryURL: URL {
        URL(fileURLWithPath: workingDirectory, isDirectory: true)
    }

    var selectedProject: MCTProject? {
        projects.first { $0.id == selectedProjectId }
    }

    var currentProfile: MCTProjectProfile? {
        selectedProject?.activeProfile
    }

    var currentServerName: String? {
        currentProfile?.server
    }

    var currentClientNames: [String] {
        currentProfile?.clients ?? []
    }

    private static func defaultWorkingDirectory() -> String {
        if let override = ProcessInfo.processInfo.environment["MCT_WORKING_DIRECTORY"], !override.isEmpty {
            return override
        }

        let current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        if current.lastPathComponent == "macos-app" {
            return current.deletingLastPathComponent().path
        }

        let bundleURL = Bundle.main.bundleURL
        let components = bundleURL.pathComponents
        if let index = components.lastIndex(of: "macos-app"), index > 1 {
            return "/" + components[1..<index].joined(separator: "/")
        }

        return current.path
    }
}
