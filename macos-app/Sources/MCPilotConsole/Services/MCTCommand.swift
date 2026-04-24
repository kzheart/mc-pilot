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

    static func clientList() -> MCTCommand {
        MCTCommand(arguments: ["client", "list"])
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
}
