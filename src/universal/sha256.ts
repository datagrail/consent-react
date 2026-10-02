import { NativeModules } from 'react-native';
import { ConsentError } from '../types';

interface DataGrailConsentCryptoModule {
  sha256Hex(input: string): Promise<string>;
}

function getNativeModule(): DataGrailConsentCryptoModule {
  const module = NativeModules.DataGrailConsentCrypto as DataGrailConsentCryptoModule | undefined;
  if (!module) {
    // NATIVE_ERROR, not NOT_INITIALIZED: this is a build problem (Expo Go, react-native-web, or
    // a missing pod install), and telling the integrator to call initialize() again would send
    // them somewhere that cannot help.
    throw new ConsentError(
      'NATIVE_ERROR',
      'DataGrailConsentCrypto native module not found. Make sure the native module is linked correctly — Universal Consent requires a native build (no Expo Go or react-native-web).',
    );
  }
  return module;
}

/**
 * SHA-256 of `input`'s raw UTF-8 bytes as 64-char lowercase hex — a bare digest with NO
 * normalization (unlike {@link computeUserHash}, which NFC-normalizes its identifier).
 *
 * Delegated to native for the same reason the user hash is: Hermes has no `crypto.subtle`, and
 * this digest is a cross-SDK signing contract — the provenance sub-digest folded into the write
 * `stringToSign` must be byte-identical to what the edge verifier and every other SDK compute, or
 * a correctly-signed write is rejected. It reuses the exact SHA-256 primitive (CryptoKit on iOS,
 * `MessageDigest` on Android) that backs {@link computeUserHash}, so the two cannot drift.
 *
 * Async because it crosses the native bridge.
 *
 * @throws ConsentError with code `NATIVE_ERROR` when the module is unlinked or the bridge call
 *   fails.
 */
export async function sha256Hex(input: string): Promise<string> {
  try {
    return await getNativeModule().sha256Hex(input);
  } catch (error: unknown) {
    if (error instanceof ConsentError) {
      throw error;
    }
    throw new ConsentError('NATIVE_ERROR', 'SHA-256 native computation failed');
  }
}
