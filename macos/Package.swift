// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LanguageFixer",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "LanguageFixerCore", targets: ["LanguageFixerCore"])
    ],
    targets: [
        .target(
            name: "LanguageFixerCore",
            resources: [.copy("Resources/ngrams.json")]
        ),
        // No XCTest/Testing available without full Xcode in this environment
        // (Command Line Tools only) — a plain executable mirrors test/detect.test.js's
        // own hand-rolled check() pattern instead of depending on a test framework.
        .executableTarget(
            name: "ParityCheck",
            dependencies: ["LanguageFixerCore"]
        ),
    ]
)
