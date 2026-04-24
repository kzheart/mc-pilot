import SwiftUI

struct StatusGridView: View {
    let status: EnvironmentStatus

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 12) {
            GridRow {
                InfoCell(title: "Project ID", value: status.projectId, icon: "number")
                InfoCell(title: "Profile", value: status.activeProfile, icon: "switch.2")
            }
            GridRow {
                InfoCell(title: "Server", value: status.serverSummary, icon: "server.rack")
                InfoCell(title: "Clients", value: status.clientSummary, icon: "display.2")
            }
            GridRow {
                InfoCell(title: "Updated", value: updatedText, icon: "clock")
                InfoCell(title: "Root", value: status.projectRootDir.isEmpty ? "Unknown" : status.projectRootDir, icon: "folder")
            }
        }
    }

    private var updatedText: String {
        guard let lastUpdated = status.lastUpdated else { return "Never" }
        return lastUpdated.formatted(date: .omitted, time: .standard)
    }
}

struct InfoCell: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            Text(value.isEmpty ? "Unknown" : value)
                .font(.callout)
                .lineLimit(4)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, minHeight: 86, alignment: .topLeading)
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
