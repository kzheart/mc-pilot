import Foundation

struct MCTProject: Identifiable, Equatable {
    let id: String
    let name: String
    let rootDir: String
    let defaultProfile: String
    let activeProfile: MCTProjectProfile?

    var detail: String {
        defaultProfile.isEmpty ? rootDir : "\(defaultProfile) · \(rootDir)"
    }
}

struct MCTProjectProfile: Equatable {
    let name: String
    let server: String
    let clients: [String]
}
