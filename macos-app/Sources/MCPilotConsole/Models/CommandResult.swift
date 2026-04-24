import Foundation

struct CommandResult: Identifiable, Equatable {
    let id = UUID()
    let command: String
    let exitCode: Int32
    let stdout: String
    let stderr: String
    let startedAt: Date
    let finishedAt: Date

    var succeeded: Bool {
        exitCode == 0
    }

    var duration: TimeInterval {
        finishedAt.timeIntervalSince(startedAt)
    }

    var displayOutput: String {
        let output = [stdout, stderr]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
        return output.isEmpty ? "(no output)" : output
    }
}
