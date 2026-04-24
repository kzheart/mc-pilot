import Foundation

struct MCTProject: Identifiable, Equatable {
    let id: String
    let name: String
    let rootDir: String
    let defaultProfile: String

    var detail: String {
        defaultProfile.isEmpty ? rootDir : "\(defaultProfile) · \(rootDir)"
    }
}
