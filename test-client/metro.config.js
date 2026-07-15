const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the parent SDK source for live reloading
config.watchFolders = [sdkRoot];

// Resolve modules from both test-client and parent SDK node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(sdkRoot, 'node_modules'),
];

// Prevent duplicate React instances. extraNodeModules alone isn't enough —
// nodeModulesPaths still lets Metro's hierarchical lookup find the SDK's own
// node_modules/react for imports made from inside sdkRoot (watched via
// watchFolders), pulling in a second React copy and breaking hooks
// ("Cannot read property 'useState' of null"). Disabling hierarchical lookup
// forces every resolution through nodeModulesPaths/extraNodeModules above.
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

module.exports = config;
