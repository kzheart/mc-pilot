import SwiftUI

struct SidebarView: View {
    @ObservedObject var store: ConsoleStore

    var body: some View {
        List(selection: projectSelection) {
            Section("Projects") {
                ForEach(store.projects) { project in
                    ProjectRow(project: project)
                        .tag(project.id)
                }

                if store.projects.isEmpty {
                    Label("No projects found", systemImage: "tray")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Runtime") {
                Label(store.status.state.rawValue, systemImage: stateIcon)
                Label(store.isRunning ? "Command running" : "Ready for command", systemImage: store.isRunning ? "clock" : "keyboard")
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("MC Pilot")
    }

    private var projectSelection: Binding<String?> {
        Binding(
            get: { store.selectedProjectId },
            set: { projectId in
                guard let projectId,
                      let project = store.projects.first(where: { $0.id == projectId }) else {
                    store.selectedProjectId = projectId
                    return
                }
                store.selectProject(project)
            }
        )
    }

    private var stateIcon: String {
        switch store.status.state {
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

private struct ProjectRow: View {
    let project: MCTProject

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "shippingbox")
                .foregroundStyle(.secondary)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .lineLimit(1)
                Text(project.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }
}
