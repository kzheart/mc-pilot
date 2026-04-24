import SwiftUI

struct CommandHistoryView: View {
    let history: [CommandResult]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Command Output")
                .font(.headline)

            if history.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "terminal")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No commands yet")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 180)
            } else {
                ForEach(history) { result in
                    CommandResultRow(result: result)
                }
            }
        }
    }
}

struct CommandResultRow: View {
    let result: CommandResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(result.command, systemImage: result.succeeded ? "checkmark.circle" : "xmark.octagon")
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(result.succeeded ? .green : .red)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()

                Text("\(String(format: "%.2f", result.duration))s")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(result.displayOutput)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.quaternary)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .padding(14)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
