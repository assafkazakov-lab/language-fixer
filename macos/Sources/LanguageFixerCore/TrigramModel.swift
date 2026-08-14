// Loads the shared trigram model (exported by tools/export_model_swift.js from
// the same in-memory data tools/build_model.js produces for ngrams.js) and
// expands it into the lookup tables LayoutModel scores against.
//
// Ported from detect.js's `expand()` / `ensureModel()`. Operates on
// Unicode.Scalar throughout (not Character/grapheme-cluster) to match
// detect.js's UTF-16-code-unit-indexed string operations — this matters
// wherever combining marks (Hebrew nikud) are present, since a base letter
// plus its diacritic is one Swift Character but two separate JS indices.
import Foundation

struct RawLanguageModel: Decodable {
    let keys: String
    let vals: String
    let words: String
}

struct RawModel: Decodable {
    let scale: Double
    let bound: String
    let he: RawLanguageModel
    let en: RawLanguageModel
}

enum Lang {
    case he, en
}

final class LanguageTable {
    let trigrams: [String: Double]
    let words: Set<String>

    init(raw: RawLanguageModel, scale: Double) {
        var trigrams: [String: Double] = [:]
        let keyScalars = Array(raw.keys.unicodeScalars)
        var i = 0
        var j = 0
        while i < keyScalars.count {
            var s = String.UnicodeScalarView()
            s.append(keyScalars[i]); s.append(keyScalars[i + 1]); s.append(keyScalars[i + 2])
            let trigram = String(s)
            let valChunk = String(raw.vals[raw.vals.index(raw.vals.startIndex, offsetBy: j)..<raw.vals.index(raw.vals.startIndex, offsetBy: j + 2)])
            let quantized = Int(valChunk, radix: 36) ?? 0
            trigrams[trigram] = Double(quantized) / scale
            i += 3
            j += 2
        }
        self.trigrams = trigrams
        self.words = Set(raw.words.split(separator: " ").map(String.init))
    }
}

public final class TrigramModel {
    let scale: Double
    let bound: String
    let tables: [Lang: LanguageTable]

    static let UNSEEN: Double = -16
    static let DICT_BONUS: Double = 3.0

    /// `Bundle.module` is internal to this target by default (SwiftPM's
    /// generated accessor) — this exposes just the URL to consumers like the
    /// ParityCheck executable that need to locate the bundled model.
    public static var bundledModelURL: URL? {
        Bundle.module.url(forResource: "ngrams", withExtension: "json")
    }

    public init(jsonURL: URL) throws {
        let data = try Data(contentsOf: jsonURL)
        let raw = try JSONDecoder().decode(RawModel.self, from: data)
        self.scale = raw.scale
        self.bound = raw.bound
        self.tables = [
            .he: LanguageTable(raw: raw.he, scale: raw.scale),
            .en: LanguageTable(raw: raw.en, scale: raw.scale),
        ]
    }

    /// Mean trigram log-probability of a word, plus a bonus if it's a known word.
    /// `word` must already be scalar-clean (only the target script's letters).
    func scoreWord(_ word: [Unicode.Scalar], lang: Lang) -> Double {
        let table = tables[lang]!
        var padded: [Unicode.Scalar] = []
        padded.append(contentsOf: bound.unicodeScalars)
        padded.append(contentsOf: word)
        padded.append(contentsOf: bound.unicodeScalars)

        var sum = 0.0
        var n = 0
        var i = 0
        while i + 3 <= padded.count {
            var s = String.UnicodeScalarView()
            s.append(padded[i]); s.append(padded[i + 1]); s.append(padded[i + 2])
            let trigram = String(s)
            sum += table.trigrams[trigram] ?? TrigramModel.UNSEEN
            n += 1
            i += 1
        }
        let mean = n > 0 ? sum / Double(n) : TrigramModel.UNSEEN
        let wordStr = String(String.UnicodeScalarView(word))
        return table.words.contains(wordStr) ? mean + TrigramModel.DICT_BONUS : mean
    }
}
