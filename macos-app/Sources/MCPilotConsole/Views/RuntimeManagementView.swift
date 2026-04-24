import SwiftUI

struct RuntimeManagementView: View {
    @ObservedObject var store: ConsoleStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Runtime")
                .font(.headline)

            if let profile = store.currentProfile {
                ServerControlView(store: store, profile: profile)
                ClientControlView(store: store, clients: profile.clients)
            } else {
                Label("No default profile target", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 72, alignment: .center)
            }
        }
        .padding(16)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ServerControlView: View {
    @ObservedObject var store: ConsoleStore
    let profile: MCTProjectProfile

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(profile.server, systemImage: "server.rack")
                    .font(.callout.weight(.semibold))

                Spacer()

                Button {
                    store.startServer()
                } label: {
                    Label("Start", systemImage: "play.fill")
                }

                Button(role: .destructive) {
                    store.stopServer()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }

                Button {
                    store.refreshServerLogs()
                } label: {
                    Label("Logs", systemImage: "arrow.clockwise")
                }
            }
            .disabled(store.isRunning)

            ServerConsoleView(store: store)
        }
    }
}

private struct ClientControlView: View {
    @ObservedObject var store: ConsoleStore
    let clients: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Clients", systemImage: "display.2")
                .font(.callout.weight(.semibold))

            if clients.isEmpty {
                Text("No clients in current profile")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            } else {
                ForEach(clients, id: \.self) { client in
                    HStack(spacing: 10) {
                        Text(client)
                            .lineLimit(1)
                            .truncationMode(.middle)

                        Spacer()

                        Button {
                            store.launchClient(client)
                        } label: {
                            Label("Launch", systemImage: "play")
                        }

                        Button(role: .destructive) {
                            store.stopClient(client)
                        } label: {
                            Label("Stop", systemImage: "xmark")
                        }
                    }
                    .disabled(store.isRunning)
                }
            }
        }
    }
}

