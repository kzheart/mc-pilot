import SwiftUI

struct ContentView: View {
    @ObservedObject var store: ConsoleStore
    @State private var customArguments = "info"

    var body: some View {
        NavigationSplitView {
            SidebarView(store: store)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HeaderView(store: store)
                    ActionPanelView(store: store, customArguments: $customArguments)
                    StatusGridView(status: store.status)
                    CommandHistoryView(history: store.history)
                }
                .padding(20)
            }
            .navigationTitle("MC Pilot Console")
        }
        .onAppear {
            if store.history.isEmpty {
                store.refresh()
            }
        }
    }
}
