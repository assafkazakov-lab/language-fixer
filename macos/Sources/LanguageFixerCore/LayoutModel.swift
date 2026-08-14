// Swift port of detect.js — layout map, conversion, wrong-layout detection.
//
// Ported line-for-line where possible so behaviour matches the JS engine
// exactly; see LanguageFixerCoreTests/ParityTests.swift, which runs the same
// fixtures test/detect.test.js does and requires identical verdicts.
//
// Operates on [Unicode.Scalar] rather than String/Character throughout, to
// match detect.js's UTF-16-code-unit indexing rather than Swift's default
// grapheme-cluster indexing — this matters for Hebrew nikud, where a base
// letter plus its diacritic is one Swift Character but two JS/scalar indices.
import Foundation

public enum Direction: String, Equatable {
    case toEnglish
    case toHebrew
}

struct TokenEvidence {
    let dir: Direction
    let ev: Double
    let len: Int
}

public final class LayoutModel {
    // ── Israeli standard keyboard layout ─────────────────────────────────
    private static let enToHe: [Unicode.Scalar: Unicode.Scalar] = {
        let pairs: [(Character, Character)] = [
            ("q", "/"), ("w", "'"), ("e", "ק"), ("r", "ר"), ("t", "א"), ("y", "ט"),
            ("u", "ו"), ("i", "ן"), ("o", "ם"), ("p", "פ"),
            ("a", "ש"), ("s", "ד"), ("d", "ג"), ("f", "כ"), ("g", "ע"), ("h", "י"),
            ("j", "ח"), ("k", "ל"), ("l", "ך"), (";", "ף"), ("'", ","),
            ("z", "ז"), ("x", "ס"), ("c", "ב"), ("v", "ה"), ("b", "נ"), ("n", "מ"),
            ("m", "צ"), (",", "ת"), (".", "ץ"), ("/", "."),
        ]
        var m: [Unicode.Scalar: Unicode.Scalar] = [:]
        for (k, v) in pairs { m[k.unicodeScalars.first!] = v.unicodeScalars.first! }
        return m
    }()

    private static let heToEn: [Unicode.Scalar: Unicode.Scalar] = {
        var m: [Unicode.Scalar: Unicode.Scalar] = [:]
        for (k, v) in enToHe { m[v] = k }
        return m
    }()

    private static let THRESHOLD = 1.2

    // Matches detect.js's tokenize()/TOKEN_RE character class exactly:
    // [א-תA-Za-z0-9_'/;,.@\-]
    private static func isTokenChar(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x05D0...0x05EA: return true // א-ת
        case 0x41...0x5A, 0x61...0x7A: return true // A-Z a-z
        case 0x30...0x39: return true // 0-9
        default: break
        }
        switch s {
        case "_", "'", "/", ";", ",", ".", "@", "\\", "-": return true
        default: return false
        }
    }

    private static func isHebrewLetter(_ s: Unicode.Scalar) -> Bool { (0x05D0...0x05EA).contains(s.value) }
    private static func isLatinLower(_ s: Unicode.Scalar) -> Bool { (0x61...0x7A).contains(s.value) }
    private static func lowered(_ s: Unicode.Scalar) -> Unicode.Scalar {
        (0x41...0x5A).contains(s.value) ? Unicode.Scalar(s.value + 0x20)! : s
    }

    private let model: TrigramModel

    public init(model: TrigramModel) {
        self.model = model
    }

    public convenience init(modelJSONURL: URL) throws {
        self.init(model: try TrigramModel(jsonURL: modelJSONURL))
    }

    // ── Conversion ─────────────────────────────────────────────────────────
    public func toHebrew(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for ch in text.unicodeScalars {
            out.append(LayoutModel.enToHe[LayoutModel.lowered(ch)] ?? ch)
        }
        return String(out)
    }

    public func toEnglish(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for ch in text.unicodeScalars {
            out.append(LayoutModel.heToEn[ch] ?? ch)
        }
        return String(out)
    }

    /// Unconditional flip, used by the hotkey — no plausibility check.
    public func flip(_ text: String) -> String {
        var he = 0, lat = 0
        for ch in text.unicodeScalars {
            if LayoutModel.isHebrewLetter(ch) { he += 1 }
            else if LayoutModel.isLatinLower(LayoutModel.lowered(ch)) { lat += 1 }
        }
        if he == 0 && lat == 0 { return text }
        return he > lat ? toEnglish(text) : toHebrew(text)
    }

    // ── Tokenizing ───────────────────────────────────────────────────────
    /// Maximal runs of token characters, with their start offset in scalar space.
    private func scanTokens(_ scalars: [Unicode.Scalar]) -> [(start: Int, scalars: [Unicode.Scalar])] {
        var result: [(Int, [Unicode.Scalar])] = []
        var i = 0
        while i < scalars.count {
            if LayoutModel.isTokenChar(scalars[i]) {
                let start = i
                var run: [Unicode.Scalar] = []
                while i < scalars.count, LayoutModel.isTokenChar(scalars[i]) {
                    run.append(scalars[i]); i += 1
                }
                result.append((start, run))
            } else {
                i += 1
            }
        }
        return result
    }

    private func tokenize(_ text: String) -> [[Unicode.Scalar]] {
        scanTokens(Array(text.unicodeScalars)).map { $0.scalars }
    }

    /// A token that isn't a natural-language word at all — never a conversion target.
    private func isCodeLike(_ token: [Unicode.Scalar]) -> Bool {
        for s in token {
            switch s.value {
            case 0x30...0x39: return true // digit
            default: break
            }
            if s == "_" || s == "@" || s == "\\" { return true }
        }
        guard let firstSep = token.firstIndex(where: { $0 == "-" || $0 == "." || $0 == "/" }) else {
            return false
        }
        for idx in (firstSep + 1)..<token.count {
            let s = token[idx]
            if (0x41...0x5A).contains(s.value) || (0x61...0x7A).contains(s.value) { return true }
        }
        return false
    }

    private func mappedLength(_ token: [Unicode.Scalar], map: [Unicode.Scalar: Unicode.Scalar]) -> Int {
        token.reduce(0) { $0 + (map[$1] != nil ? 1 : 0) }
    }

    private func stripToRange(_ scalars: [Unicode.Scalar], keep: (Unicode.Scalar) -> Bool) -> [Unicode.Scalar] {
        scalars.filter(keep)
    }

    /// Evidence that `token` should be flipped. Positive means "convert"; the
    /// direction (`dir`) is determined purely by the token's script, not by
    /// whether conversion is actually warranted — see convertSpan's comment.
    private func tokenEvidence(_ token: [Unicode.Scalar]) -> TokenEvidence? {
        let lower = token.map(LayoutModel.lowered)
        var heCount = 0, latCount = 0
        for s in lower {
            if LayoutModel.isHebrewLetter(s) { heCount += 1 }
            else if LayoutModel.isLatinLower(s) { latCount += 1 }
        }
        if heCount > 0 && latCount > 0 { return nil }

        if heCount >= 2 {
            let asEnFull = toEnglish(String(String.UnicodeScalarView(lower)))
            let asEn = asEnFull.unicodeScalars.filter { LayoutModel.isLatinLower($0) }
            if asEn.isEmpty { return nil }
            let heOnly = lower.filter(LayoutModel.isHebrewLetter)
            let ev = model.scoreWord(Array(asEn), lang: .en) - model.scoreWord(heOnly, lang: .he)
            return TokenEvidence(dir: .toEnglish, ev: ev, len: mappedLength(lower, map: LayoutModel.heToEn))
        }
        if latCount >= 2 {
            let asHeFull = toHebrew(String(String.UnicodeScalarView(lower)))
            let asHe = asHeFull.unicodeScalars.filter(LayoutModel.isHebrewLetter)
            if asHe.isEmpty { return nil }
            let enOnly = lower.filter(LayoutModel.isLatinLower)
            let ev = model.scoreWord(Array(asHe), lang: .he) - model.scoreWord(enOnly, lang: .en)
            return TokenEvidence(dir: .toHebrew, ev: ev, len: mappedLength(lower, map: LayoutModel.enToHe))
        }
        return nil
    }

    // ── Detection ────────────────────────────────────────────────────────
    public func detectConversion(_ text: String) -> Direction? {
        if text.isEmpty { return nil }
        if text.range(of: "https?://|www\\.|\\S+@\\S+", options: .regularExpression) != nil { return nil }

        let tokens = tokenize(text)
        var totals: [Direction: Double] = [.toEnglish: 0, .toHebrew: 0]
        var lengths: [Direction: Int] = [.toEnglish: 0, .toHebrew: 0]
        var letters = 0

        for token in tokens {
            if isCodeLike(token) { return nil }
            guard let r = tokenEvidence(token) else { continue }
            letters += r.len
            totals[r.dir]! += r.ev * Double(r.len)
            lengths[r.dir]! += r.len
        }
        if letters < 4 { return nil }

        let dir: Direction = lengths[.toEnglish]! >= lengths[.toHebrew]! ? .toEnglish : .toHebrew
        guard lengths[dir]! > 0 else { return nil }
        return (totals[dir]! / Double(lengths[dir]!)) > LayoutModel.THRESHOLD ? dir : nil
    }

    /// Convert only the tokens that are actually in the wrong script, leaving
    /// the rest of the field untouched. Gates on the token's OWN evidence
    /// sign (r.ev > 0), not just script match — a correctly-typed word
    /// sharing a script with the garbled majority of the field (e.g. one real
    /// Hebrew word inside an otherwise-garbled English sentence) still has
    /// r.dir equal to the field's overall direction; only r.ev distinguishes
    /// it. See detect.js's convertSpan for the JS-side fix this mirrors.
    public func convertSpan(_ text: String, direction: Direction) -> String {
        var out = Array(text.unicodeScalars)
        for (start, tok) in scanTokens(out) {
            if isCodeLike(tok) { continue }
            guard let r = tokenEvidence(tok), r.dir == direction, r.ev > 0 else { continue }
            let converted = direction == .toEnglish
                ? toEnglish(String(String.UnicodeScalarView(tok)))
                : toHebrew(String(String.UnicodeScalarView(tok)))
            let convertedScalars = Array(converted.unicodeScalars)
            for i in 0..<tok.count { out[start + i] = convertedScalars[i] }
        }
        return String(String.UnicodeScalarView(out))
    }
}
