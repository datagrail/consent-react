// Standalone pure-JVM Gradle project whose ONLY purpose is to run the cross-SDK golden-vector tests
// for the React-free Kotlin crypto core (`DataGrailConsentCryptoCore`) in CI, with no Android SDK,
// no emulator, and no `com.facebook.react:react-android` resolution. It shares the exact source
// files that ship in the `android/` library (see build.gradle.kts), so a pass here proves the
// on-device digest matches the edge verifier and every other SDK.
rootProject.name = "android-crypto-core"
