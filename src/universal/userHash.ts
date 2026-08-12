import { NativeModules } from 'react-native';
import { ConsentError } from '../types';

interface DataGrailConsentCryptoModule {
  computeUserHash(customerId: string, projectId: string, identifier: string): Promise<string>;
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
 * Compute the Universal Consent user hash for an identifier.
 *
 * `SHA-256("{customerId}:{projectId}:{normalizedIdentifier}")` as 64-char lowercase hex, where
 * normalization is Unicode NFC → trim → lowercase.
 *
 * Delegated to native rather than implemented here. Hermes has no SHA-256 (`crypto.subtle` is
 * absent) and no dependable `String.prototype.normalize`, and a second JS implementation of the
 * hash would be a third copy of a contract that must agree byte-for-byte with web, iOS, Android
 * and the customer's backend. A hash that disagrees splits one user across two consent records,
 * which is silent — no error, the user just stops seeing their consent follow them. Reusing the
 * platforms' own crypto is what makes that divergence impossible.
 *
 * Async because it crosses the bridge. This is not on a hot path: it runs once per
 * `setUserIdentifier`/rehydrate call, not per consent check.
 *
 * @throws ConsentError with code `VALIDATION_ERROR` when the identifier is empty after
 *   normalizing — that hash would be the tenant prefix alone, shared by every such caller.
 * @throws ConsentError with code `NATIVE_ERROR` when the module is unlinked or the bridge call
 *   fails for any other reason.
 */
export async function computeUserHash(
  customerId: string,
  projectId: string,
  identifier: string,
): Promise<string> {
  try {
    return await getNativeModule().computeUserHash(customerId, projectId, identifier);
  } catch (error: unknown) {
    if (error instanceof ConsentError) throw error;
    // The native side rejects with this code for an identifier that normalizes to "". Surfacing
    // it as VALIDATION_ERROR rather than a generic failure matters: it is a caller bug (an
    // unauthenticated or blank identifier reached the SDK), not a transient condition to retry.
    const code = (error as { code?: string } | null)?.code;
    if (code === 'INVALID_IDENTIFIER') {
      throw new ConsentError(
        'VALIDATION_ERROR',
        'identifier must not be empty after normalization',
      );
    }
    // Anything else came from the bridge, not from the caller. NATIVE_ERROR rather than
    // VALIDATION_ERROR so an integrator is not told their input was bad when it wasn't.
    const message = error instanceof Error ? error.message : 'Failed to compute user hash';
    throw new ConsentError('NATIVE_ERROR', message);
  }
}
