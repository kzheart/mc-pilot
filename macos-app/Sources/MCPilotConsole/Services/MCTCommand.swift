import Foundation

struct MCTCommand: Equatable {
    var arguments: [String]

    var displayString: String {
        (["mct"] + arguments).joined(separator: " ")
    }
}

enum MCTCommands {
    static func info() -> MCTCommand {
        MCTCommand(arguments: ["info"])
    }

    static func serverStatus() -> MCTCommand {
        MCTCommand(arguments: ["server", "status"])
    }

    static func serverStart(_ name: String?) -> MCTCommand {
        MCTCommand(arguments: compactArguments(["server", "start", normalizedName(name)]))
    }

    static func serverStop(_ name: String?) -> MCTCommand {
        MCTCommand(arguments: compactArguments(["server", "stop", normalizedName(name)]))
    }

    static func serverLogs(_ name: String?, tail: Int = 120) -> MCTCommand {
        compactArguments(["server", "logs", normalizedName(name), "--tail", String(max(tail, 1))])
            .withCommand()
    }

    static func serverExec(_ command: String, server: String?) -> MCTCommand {
        MCTCommand(arguments: compactArguments(["server", "exec", command, "--server", normalizedName(server)]))
    }

    static func clientList() -> MCTCommand {
        MCTCommand(arguments: ["client", "list"])
    }

    static func clientLaunch(_ name: String?) -> MCTCommand {
        MCTCommand(arguments: compactArguments(["client", "launch", normalizedName(name)]))
    }

    static func clientStop(_ name: String) -> MCTCommand {
        MCTCommand(arguments: ["client", "stop", name])
    }

    static func up(profile: String?) -> MCTCommand {
        var args = ["up"]
        if let profile, !profile.isEmpty, profile != "Unknown" {
            args += ["--profile", profile]
        }
        return MCTCommand(arguments: args)
    }

    static func down() -> MCTCommand {
        MCTCommand(arguments: ["down"])
    }

    static func screenshot() -> MCTCommand {
        MCTCommand(arguments: ["screenshot"])
    }

    private static func normalizedName(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func compactArguments(_ arguments: [String?]) -> [String] {
        arguments.compactMap { $0 }
    }
}

private extension Array where Element == String {
    func withCommand() -> MCTCommand {
        MCTCommand(arguments: self)
    }
}
