// Mirrors test/detect.test.js section-for-section: the Swift port must reach
// identical verdicts to the JS engine on every fixture that suite checks.
// "Model parity" is Milestone 1's explicit verification requirement
// (docs/PLAN.md). Run with: swift run ParityCheck
import Foundation
import LanguageFixerCore

var passed = 0
var failures: [String] = []

func check(_ name: String, _ cond: @autoclosure () -> Bool, _ detail: @autoclosure () -> String = "") {
    if cond() { passed += 1; return }
    let d = detail()
    failures.append(d.isEmpty ? name : "\(name)\n      \(d)")
}

guard let url = TrigramModel.bundledModelURL else {
    fatalError("ngrams.json not bundled — run tools/export_model_swift.js")
}
let D = try! LayoutModel(modelJSONURL: url)

// Batch mode: `swift run ParityCheck --corpus <file>` prints one line per
// input word — `word<TAB>result` — for cross-checking against the JS engine
// on the same corpus sample, beyond this file's curated fixtures.
if CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "--corpus" {
    let path = CommandLine.arguments[2]
    let lines = (try? String(contentsOfFile: path, encoding: .utf8))?.split(separator: "\n") ?? []
    for line in lines {
        let word = String(line)
        let result = D.detectConversion(word)
        print("\(word)\t\(result?.rawValue ?? "null")")
    }
    exit(0)
}

// ── 1. Layout map round-trips ──────────────────────────────────────────────
for ch in "abcdefghijklmnopqrstuvwxyz;,./'" {
    let there = D.toHebrew(String(ch))
    check("round-trip \(ch)", D.toEnglish(there) == String(ch),
          "\(ch) -> \(there) -> \(D.toEnglish(there))")
}
check("q maps to /", D.toHebrew("q") == "/")
check("w maps to apostrophe", D.toHebrew("w") == "'")
check("world converts cleanly", D.toHebrew("world") == "'םרךג", "got \(D.toHebrew("world"))")

// ── 2. Correct text is never flagged ───────────────────────────────────────
let hebrewOK = [
    "מה שלומך", "תודה רבה", "בוקר טוב", "סבבה", "מתי נפגשים", "אני צריך עזרה",
    "שלום", "להתראות", "בבקשה", "אני הולך הביתה", "זה נראה טוב", "כמה זה עולה",
    "איפה אתה גר", "יום הולדת שמח", "אין בעיה", "רגע אחד בבקשה",
]
let englishOK = [
    "docker compose up", "github", "npm install react", "kubectl apply", "assaf",
    "brainstorm", "language fixer", "hello", "hey", "claude", "anthropic",
    "postgres", "nginx", "tel aviv", "good morning everyone", "see you tomorrow",
    "what time is the meeting", "please review this pull request",
]
for s in hebrewOK {
    check("no false positive (he): \(s)", D.detectConversion(s) == nil,
          "flagged as \(String(describing: D.detectConversion(s)))")
}
for s in englishOK {
    check("no false positive (en): \(s)", D.detectConversion(s) == nil,
          "flagged as \(String(describing: D.detectConversion(s)))")
}

// ── 3. Non-language strings are never flagged ──────────────────────────────
let skip = [
    "Xk9vRm2p", "hunter2", "a1b2c3d4", "user@example.com", "https://example.com/x",
    "src/main.js", "my-branch-name", "C:\\Users\\test", "2024-01-15",
]
for s in skip {
    check("skips non-language: \(s)", D.detectConversion(s) == nil,
          "flagged as \(String(describing: D.detectConversion(s)))")
}

// ── 4. Genuinely mistyped text is caught ────────────────────────────────────
let enWords = ["hello", "thanks", "docker", "meeting", "tomorrow", "please",
                "password", "morning", "question", "water", "window", "where"]
let hit = enWords.filter { D.detectConversion(D.toHebrew($0)) == .toEnglish }.count
check("catches English typed on Hebrew layout (\(hit)/\(enWords.count))",
      hit >= enWords.count - 1, "only \(hit) of \(enWords.count)")

let heWords = ["שלום", "תודה", "בבקשה", "להתראות", "מחשב", "עבודה",
                "בוקר", "ילדים", "משפחה", "אנשים"]
let hit2 = heWords.filter { D.detectConversion(D.toEnglish($0)) == .toHebrew }.count
check("catches Hebrew typed on English layout (\(hit2)/\(heWords.count))",
      hit2 >= heWords.count - 1, "only \(hit2) of \(heWords.count)")

// ── 5. Conversion touches only the wrong-script words ───────────────────────
let mixed = "I told him יקךךם yesterday"
let out = D.convertSpan(mixed, direction: .toEnglish)
check("converts only the mistyped word", out == "I told him hello yesterday", "got \(out)")
check("conversion preserves length", out.unicodeScalars.count == mixed.unicodeScalars.count)

let withCode = "run npm install then יקךךם"
let out2 = D.convertSpan(withCode, direction: .toEnglish)
check("leaves correct English untouched", out2 == "run npm install then hello", "got \(out2)")

// Same regression this session's stress test found and fixed in detect.js: a
// correct same-script word must survive a whole-field convert triggered by
// genuinely garbled text elsewhere in the field.
let codeSwitch = D.toHebrew("hello world how are you doing today") + " שלום"
let out3 = D.convertSpan(codeSwitch, direction: .toEnglish)
check("leaves a correct same-script word untouched", out3.hasSuffix(" שלום"), "got \(out3)")
check("still fixes the actually-garbled part",
      out3 == "hello world how are you doing today שלום", "got \(out3)")

// ── 6. The hotkey flip is unconditional and reversible ──────────────────────
for s in ["xk9vrm2p", "hunter2", "github", "שלום"] {
    check("flip is its own inverse: \(s)", D.flip(D.flip(s)) == s,
          "\(s) -> \(D.flip(s)) -> \(D.flip(D.flip(s)))")
}
check("flip round-trips mixed case up to case", D.flip(D.flip("Xk9vRm2p")) == "xk9vrm2p",
      "got \(D.flip(D.flip("Xk9vRm2p")))")
check("flip acts even when detection declines", D.flip("github") != "github")

// ── 7. No flicker: once a prefix is flagged, longer prefixes stay flagged ───
for word in ["hello", "thanks", "tomorrow", "meeting"] {
    let mistyped = Array(D.toHebrew(word).unicodeScalars)
    var fired = false, flapped = false
    for i in 1...mistyped.count {
        let prefix = String(String.UnicodeScalarView(mistyped[0..<i]))
        let hitNow = D.detectConversion(prefix) == .toEnglish
        if hitNow { fired = true } else if fired { flapped = true }
    }
    check("no flicker while typing \"\(word)\"", !flapped,
          "suggestion appeared then vanished on a longer prefix")
}

// ── Report ───────────────────────────────────────────────────────────────────
print("\(passed) passed, \(failures.count) failed")
if !failures.isEmpty {
    print("")
    for f in failures { print("  FAIL  \(f)") }
    exit(1)
}
