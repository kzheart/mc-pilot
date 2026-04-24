import Foundation

protocol MCTClient {
    func run(_ command: MCTCommand, workingDirectory: URL) async -> CommandResult
}

struct ProcessMCTClient: MCTClient {
    func run(_ command: MCTCommand, workingDirectory: URL) async -> CommandResult {
        await withCheckedContinuation { continuation in
            let startedAt = Date()
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()

            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["mct"] + command.arguments
            process.currentDirectoryURL = workingDirectory
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            process.terminationHandler = { process in
                let stdout = String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                let stderr = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                continuation.resume(
                    returning: CommandResult(
                        command: command.displayString,
                        exitCode: process.terminationStatus,
                        stdout: stdout,
                        stderr: stderr,
                        startedAt: startedAt,
                        finishedAt: Date()
                    )
                )
            }

            do {
                try process.run()
            } catch {
                continuation.resume(
                    returning: CommandResult(
                        command: command.displayString,
                        exitCode: 127,
                        stdout: "",
                        stderr: error.localizedDescription,
                        startedAt: startedAt,
                        finishedAt: Date()
                    )
                )
            }
        }
    }
}
