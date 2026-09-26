// swift-tools-version:5.7
import PackageDescription

// Standalone SwiftPM package for the React-free crypto core. It exists ONLY so the cross-SDK
// golden vectors for `sha256Hex` / `computeUserHash` can be asserted by `swift test` in CI —
// fast, no simulator, no CocoaPods, no React. It compiles the single `DataGrailConsentCryptoCore.swift`
// that the shipped `DataGrailConsentCrypto` bridge delegates to, so a pass here guarantees the
// on-device digest matches the edge verifier and every other SDK. The React-coupled bridge files
// in this directory are intentionally NOT part of any target here; they are built by CocoaPods.
let package = Package(
  name: "DataGrailConsentCryptoCore",
  platforms: [
    .macOS(.v11),
    .iOS(.v14),
  ],
  targets: [
    .target(
      name: "DataGrailConsentCryptoCore",
      path: ".",
      sources: ["DataGrailConsentCryptoCore.swift"]
    ),
    .testTarget(
      name: "DataGrailConsentCryptoCoreTests",
      dependencies: ["DataGrailConsentCryptoCore"],
      path: "Tests",
      sources: ["DataGrailConsentCryptoCoreTests.swift"]
    ),
  ]
)
