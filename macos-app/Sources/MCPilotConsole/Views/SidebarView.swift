import SwiftUI

struct SidebarView: View {
    let status: EnvironmentStatus
    let isRunning: Bool

    var body: some View {
        List {
            Section("Project") {
                Label(status.projectName, systemImage: "shippingbox")
                Label(status.activeProfile, systemImage: "switch.2")
            }

            Section("Runtime") {
                Label(status.state.rawValue, systemImage: stateIcon)
                Label(isRunning ? "Command running" : "Ready for command", systemImage: isRunning ? "clock" : "keyboard")
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("MC Pilot")
    }

    private var stateIcon: String {
        switch status.state {
        case .idle:
            return "circle"
        case .loading:
            return "hourglass"
        case .ready:
            return "checkmark.circle"
        case .warning:
            return "exclamationmark.triangle"
        case .failed:
            return "xmark.octagon"
        }
    }
}
