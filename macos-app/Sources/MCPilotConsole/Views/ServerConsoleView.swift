import SwiftUI

struct ServerConsoleView: View {
    @ObservedObject var store: ConsoleStore
    @State private var serverCommand = ""
    private let logTimer = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollViewReader { proxy in
                ScrollView {
                    Text(store.serverLog.isEmpty ? "No server logs loaded" : store.serverLog)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
                        .padding(10)
                        .id("server-log-bottom")
                }
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .onChange(of: store.serverLog) { _ in
                    proxy.scrollTo("server-log-bottom", anchor: .bottom)
                }
            }

            HStack(spacing: 8) {
                Text(">")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(.secondary)

                TextField("server command", text: $serverCommand)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(sendCommand)

                Button(action: sendCommand) {
                    Label("Send", systemImage: "paperplane")
                }
                .disabled(store.isRunning || serverCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .onReceive(logTimer) { _ in
            guard !store.isRunning, store.currentServerName != nil else { return }
            store.refreshServerLogs()
        }
    }

    private func sendCommand() {
        let command = serverCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else { return }
        store.sendServerCommand(command)
        serverCommand = ""
    }
}

