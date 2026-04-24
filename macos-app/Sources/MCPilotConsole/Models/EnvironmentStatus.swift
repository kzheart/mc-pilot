import Foundation

enum RuntimeState: String, Equatable {
    case idle = "Idle"
    case loading = "Loading"
    case ready = "Ready"
    case warning = "Warning"
    case failed = "Failed"
}

struct EnvironmentStatus: Equatable {
    var state: RuntimeState = .idle
    var projectName = "Unknown"
    var projectId = "Unknown"
    var activeProfile = "Unknown"
    var projectRootDir = ""
    var serverSummary = "Not checked"
    var clientSummary = "Not checked"
    var lastUpdated: Date?

    var menuTitle: String {
        switch state {
        case .idle:
            return "MC Pilot"
        case .loading:
            return "MC Pilot..."
        case .ready:
            return "MC Pilot Ready"
        case .warning:
            return "MC Pilot Check"
        case .failed:
            return "MC Pilot Error"
        }
    }
}
