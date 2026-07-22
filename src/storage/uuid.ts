// Must be imported before `generateUuidV4` runs — installs
// crypto.getRandomValues, which Hermes doesn't provide natively, so we have a
// secure RNG to draw from.
import 'react-native-get-random-values';

const BYTE_TO_HEX: string[] = [];
for (let i = 0; i < 256; i++) {
  BYTE_TO_HEX.push((i + 0x100).toString(16).slice(1));
}

/**
 * Generate an RFC 4122 version 4 UUID.
 *
 * Implemented in-package (rather than pulling in the `uuid` npm package) so the
 * SDK has no ESM-only dependencies that break consumers' Metro bundling on
 * React Native 0.76's default resolver. Uses the crypto RNG installed by the
 * `react-native-get-random-values` import above.
 */
export function generateUuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Per RFC 4122 §4.4: set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return (
    BYTE_TO_HEX[bytes[0]!]! +
    BYTE_TO_HEX[bytes[1]!]! +
    BYTE_TO_HEX[bytes[2]!]! +
    BYTE_TO_HEX[bytes[3]!]! +
    '-' +
    BYTE_TO_HEX[bytes[4]!]! +
    BYTE_TO_HEX[bytes[5]!]! +
    '-' +
    BYTE_TO_HEX[bytes[6]!]! +
    BYTE_TO_HEX[bytes[7]!]! +
    '-' +
    BYTE_TO_HEX[bytes[8]!]! +
    BYTE_TO_HEX[bytes[9]!]! +
    '-' +
    BYTE_TO_HEX[bytes[10]!]! +
    BYTE_TO_HEX[bytes[11]!]! +
    BYTE_TO_HEX[bytes[12]!]! +
    BYTE_TO_HEX[bytes[13]!]! +
    BYTE_TO_HEX[bytes[14]!]! +
    BYTE_TO_HEX[bytes[15]!]!
  );
}
