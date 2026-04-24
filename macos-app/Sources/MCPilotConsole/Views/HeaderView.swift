import SwiftUI

struct HeaderView: View {
    @ObservedObject var store: ConsoleStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.status.projectName)
                        .font(.title2.weight(.semibold))
                    Text(store.status.projectRootDir.isEmpty ? store.workingDirectory : store.status.projectRootDir)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer()

                StatusBadge(state: store.status.state)
            }

            HStack(spacing: 8) {
                TextField("Working directory", text: $store.workingDirectory)
                    .textFieldStyle(.roundedBorder)
                Button {
                    store.refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(store.isRunning)
            }
        }
        .padding(16)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct StatusBadge: View {
    let state: RuntimeState

    var body: some View {
        Label(state.rawValue, systemImage: icon)
            .font(.callout.weight(.medium))
            .foregroundStyle(foregroundStyle)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(backgroundStyle)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var icon: String {
        switch state {
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

    private var foregroundStyle: Color {
        switch state {
        case .idle:
            return .secondary
        case .loading:
            return .accentColor
        case .ready:
            return .green
        case .warning:
            return .orange
        case .failed:
            return .red
        }
    }

    private var backgroundStyle: Color {
        foregroundStyle.opacity(0.12)
    }
}
