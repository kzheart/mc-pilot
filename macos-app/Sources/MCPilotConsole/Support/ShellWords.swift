import Foundation

enum ShellWords {
    static func split(_ input: String) -> [String] {
        var words: [String] = []
        var current = ""
        var quote: Character?
        var escaping = false

        for character in input {
            if escaping {
                current.append(character)
                escaping = false
                continue
            }

            if character == "\\" {
                escaping = true
                continue
            }

            if let activeQuote = quote {
                if character == activeQuote {
                    quote = nil
                } else {
                    current.append(character)
                }
                continue
            }

            if character == "\"" || character == "'" {
                quote = character
                continue
            }

            if character.isWhitespace {
                if !current.isEmpty {
                    words.append(current)
                    current = ""
                }
                continue
            }

            current.append(character)
        }

        if escaping {
            current.append("\\")
        }
        if !current.isEmpty {
            words.append(current)
        }
        return words
    }
}
