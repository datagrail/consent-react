const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '..');

// When USE_BUILT_LIB is set, resolve the SDK to its built output (lib/) instead
// of the raw TypeScript source, so the app exercises exactly what npm ships.
// Otherwise (default) run against src/ with live reloading. See `resolveRequest`
// below for the redirect and the `*:lib` scripts in package.json.
const useBuiltLib = !!process.env.USE_BUILT_LIB;
const SDK_PACKAGE = '@datagrail.io/react-native-consent';
const sdkBuiltEntry = path.resolve(sdkRoot, 'lib/module/index.js');

const config = getDefaultConfig(projectRoot);

// Watch the whole parent SDK for live reloading. This must stay sdkRoot (not
// just lib/) even in built-lib mode: Metro can only serve files under a watched
// root, and RN's dev-mode react-refresh runtime is resolved from the SDK root's
// node_modules. Narrowing to lib/ would leave react-refresh unresolvable. The
// resolveRequest redirect below is what actually forces SDK imports to lib/.
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

// Belt-and-suspenders: extraNodeModules/nodeModulesPaths still let the SDK's
// own copies of react/react-native win for imports originating inside the
// symlinked SDK source (e.g. `react/jsx-runtime` emitted by the automatic JSX
// runtime, or `react-native` deep imports). A duplicate React means the SDK's
// hooks run against a null dispatcher and every SDK component crashes with
// "Cannot read property 'useState' of null". Force every react / react-native
// import — bare or subpath, whatever the origin — to the app's single copy.
const dedupedPackages = ['react', 'react-native'];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force the SDK's package entry to the built output. Only the bare specifier
  // is redirected; subpath imports (none today) would fall through unchanged.
  if (useBuiltLib && moduleName === SDK_PACKAGE) {
    return context.resolveRequest(context, sdkBuiltEntry, platform);
  }
  for (const pkg of dedupedPackages) {
    if (moduleName === pkg || moduleName.startsWith(`${pkg}/`)) {
      const redirected = path.join(projectRoot, 'node_modules', moduleName);
      return context.resolveRequest(context, redirected, platform);
    }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
