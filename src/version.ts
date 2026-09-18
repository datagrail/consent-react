function readVersion(): string {
  try {
    // Metro resolves this package via its "react-native" field (src/index),
    // so on-device this always compiles from src/ — one directory above
    // this file is the package root. ts-jest running against src/ in this
    // repo's own tests hits the same path.
    return (require('../package.json') as { version: string }).version;
  } catch {
    // A consumer requiring the published lib/commonjs or lib/module output
    // (e.g. a downstream app's own Jest run, which resolves via package.json's
    // "main" field rather than "react-native") sits one directory deeper than
    // src/. Built from parts so Metro's static bundler — which only ever
    // takes the branch above — never has to resolve a path that doesn't
    // exist from src/.
    const upOneMore = ['..', '..', 'package.json'].join('/');
    return (require(upOneMore) as { version: string }).version;
  }
}

/**
 * SDK version, sourced from package.json — sent as `library_version` on
 * analytics calls (mirrors the podspec/gradle version constants in the
 * iOS/Android SDKs).
 */
export const SDK_VERSION: string = readVersion();

/**
 * Consent-config wire schema version this SDK's models are written against
 * — sent as `schema_version` on analytics calls, distinct from
 * `CURRENT_SCHEMA_VERSION` in `storage/keys.ts` (this SDK's own local MMKV
 * storage-format migration version — an unrelated concept). This SDK
 * mirrors the v1 wire format byte-for-byte, so this is a build-time
 * constant, not something read from the fetched config.
 */
export const CONFIG_SCHEMA_VERSION = 'v1';
