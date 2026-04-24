import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct MCPilotConsoleApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store = ConsoleStore()
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        WindowGroup("MC Pilot Console", id: "main") {
            ContentView(store: store)
                .frame(minWidth: 960, minHeight: 620)
        }
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Refresh Status") {
                    store.refresh()
                }
                .keyboardShortcut("r", modifiers: [.command])
            }
        }

        MenuBarExtra(store.status.menuTitle, systemImage: menuSystemImage) {
            MenuBarContentView(store: store) {
                openWindow(id: "main")
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    private var menuSystemImage: String {
        switch store.status.state {
        case .idle:
            return "square.dashed"
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
