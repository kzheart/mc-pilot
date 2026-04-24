import AppKit
import SwiftUI

struct MenuBarContentView: View {
    @ObservedObject var store: ConsoleStore
    let openMainWindow: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(shortTitle(store.status.projectName))
                .font(.headline)

            Text("Profile: \(shortTitle(store.status.activeProfile))")
                .foregroundStyle(.secondary)

            Divider()

            Button("Open Console", action: openMainWindow)

            Button("Refresh") {
                store.refresh()
            }
            .disabled(store.isRunning)

            Button("Start Profile") {
                store.startCurrentProfile()
            }
            .disabled(store.isRunning)

            Button("Stop All", role: .destructive) {
                store.stopAll()
            }
            .disabled(store.isRunning)

            Button("Screenshot") {
                store.takeScreenshot()
            }
            .disabled(store.isRunning)

            Divider()

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
        .padding(.vertical, 4)
    }

    private func shortTitle(_ title: String) -> String {
        if title.count <= 30 {
            return title
        }
        return String(title.prefix(27)) + "..."
    }
}
