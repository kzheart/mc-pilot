import SwiftUI

struct ActionPanelView: View {
    @ObservedObject var store: ConsoleStore
    @Binding var customArguments: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Actions")
                .font(.headline)

            HStack(spacing: 8) {
                Button {
                    store.startCurrentProfile()
                } label: {
                    Label("Start Profile", systemImage: "play.fill")
                }

                Button(role: .destructive) {
                    store.stopAll()
                } label: {
                    Label("Stop All", systemImage: "stop.fill")
                }

                Button {
                    store.takeScreenshot()
                } label: {
                    Label("Screenshot", systemImage: "camera")
                }

                Spacer()
            }
            .disabled(store.isRunning)

            HStack(spacing: 8) {
                Text("mct")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(.secondary)

                TextField("arguments", text: $customArguments)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        store.runCustom(arguments: customArguments)
                    }

                Button {
                    store.runCustom(arguments: customArguments)
                } label: {
                    Label("Run", systemImage: "terminal")
                }
                .disabled(store.isRunning || customArguments.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(16)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
