require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "datagrail-react-native-consent"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = { :type => "Apache-2.0", :file => "LICENSE" }
  s.authors      = { "DataGrail" => "engineering@datagrail.io" }
  s.source       = { :git => package["repository"]["url"], :tag => s.version.to_s }
  s.platforms    = { :ios => "14.0" }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  # Package.swift is the manifest for the standalone SwiftPM crypto-core test package (see below);
  # it must not be compiled into the shipped pod. Tests are dev-only via the test_spec.
  s.exclude_files = "ios/Tests/**/*", "ios/Package.swift"
  s.dependency "React-Core"
  s.frameworks   = "AppTrackingTransparency", "CryptoKit"

  # Golden-vector unit tests for the native user hash, run against the React-coupled bridge class.
  # Not shipped to consumers — CocoaPods only compiles a test_spec for `pod lib lint` / development
  # pods. Run with:
  #   pod lib lint --include-podspecs='**/*.podspec' --allow-warnings
  #
  # DataGrailConsentCryptoCoreTests.swift is excluded here: it exercises the React-free crypto core
  # through the standalone SwiftPM package (ios/Package.swift) via `swift test`, which is what CI
  # runs, and it imports the `DataGrailConsentCryptoCore` SwiftPM module that does not exist in the
  # CocoaPods build.
  s.test_spec "Tests" do |test_spec|
    test_spec.source_files  = "ios/Tests/**/*.{swift}"
    test_spec.exclude_files = "ios/Tests/DataGrailConsentCryptoCoreTests.swift"
    test_spec.frameworks    = "XCTest"
  end
end
