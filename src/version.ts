import { version } from '../package.json';

/**
 * SDK version, sourced from package.json — sent as `library_version` on
 * analytics calls (mirrors the podspec/gradle version constants in the
 * iOS/Android SDKs).
 */
export const SDK_VERSION: string = version;
