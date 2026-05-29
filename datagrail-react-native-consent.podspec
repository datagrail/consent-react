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
  s.dependency "React-Core"
  s.frameworks   = "AppTrackingTransparency"
end
