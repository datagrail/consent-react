/**
 * The exact material the SDK hands the customer-provided `getSignature` callback before a
 * Universal Consent write.
 *
 * The SDK — not the callback — owns the `timestamp` and `nonce` and has already assembled the
 * canonical `stringToSign`. The callback's ONLY job is to HMAC that string with the shared secret
 * and return the result. `customerId`, `userHash`, `timestamp`, and `nonce` are provided as
 * discrete fields for logging/validation, but the value that must be signed is `stringToSign`
 * verbatim — the DataGrail edge recomputes the HMAC over the exact same bytes (and over the
 * `X-DG-Nonce` / `X-DG-Timestamp` header values, which the SDK sets from this same `nonce` and
 * `timestamp`).
 */
export interface UniversalConsentSignaturePayload {
  /**
   * The canonical string to HMAC, exactly `"{customerId}:{userHash}:{timestamp}:{nonce}"`.
   * Sign THIS string — do not reassemble it from the fields below, or a formatting drift will
   * silently produce rejected writes.
   */
  stringToSign: string;
  /** The DataGrail customer id (tenant). */
  customerId: string;
  /** SHA-256 user hash the SDK computed on-device. */
  userHash: string;
  /** Unix timestamp in seconds, minted by the SDK. Also sent as `X-DG-Timestamp`. */
  timestamp: number;
  /** Fresh per-write 128-bit nonce as 32 lowercase hex, minted by the SDK. Also sent as `X-DG-Nonce`. */
  nonce: string;
}

/**
 * Signature material returned by the customer-provided `getSignature` callback.
 *
 * The DataGrail SDK never computes the HMAC itself — the shared secret lives only on the
 * customer's backend and at the DataGrail edge. Given a {@link UniversalConsentSignaturePayload},
 * the customer's backend computes `HMAC-SHA256(rawSecretBytes, payload.stringToSign)` as lowercase
 * hex, where `rawSecretBytes` is the 64-hex shared secret decoded to its raw bytes (those bytes
 * are the HMAC key — the hex string itself is NOT the key). It returns the resulting signature
 * together with the key id (identifies which secret was used, for rotation). The SDK owns the
 * timestamp and nonce and attaches everything as request headers on the Universal Consent write.
 */
export interface UniversalConsentSignature {
  /** Hex-encoded HMAC-SHA256 signature over `payload.stringToSign`, computed by the customer backend. */
  signature: string;
  /** Identifier of the HMAC secret used (supports key rotation). */
  keyId: string;
}

/**
 * Customer-provided signature provider, invoked by the SDK immediately before a Universal
 * Consent write. The SDK hands it a fully-assembled {@link UniversalConsentSignaturePayload}
 * (SDK-owned timestamp + nonce, canonical string) and expects back only `{ signature, keyId }`.
 */
export type SignatureProvider = (
  payload: UniversalConsentSignaturePayload,
) => Promise<UniversalConsentSignature>;

/**
 * Consent preferences as stored in / returned by the Universal Consent API.
 *
 * Unlike {@link ConsentPreferences} (which uses an array of `CategoryConsent`), the Universal
 * Consent wire format uses a MAP of `{ categoryKey: boolean }` for `cookieOptions`, on both
 * read and write.
 */
export interface UniversalConsentPreferences {
  isCustomised: boolean;
  cookieOptions: Record<string, boolean>;
}

/**
 * A Universal Consent record returned by `GET /universal_consent`.
 *
 * IMPORTANT: this data is RAW and UNRECONCILED. The server never computes an "effective"
 * consent state — it returns the stored preferences plus the IAB signals (`gpc`, `tcfString`,
 * `gppString`) exactly as written. Clients MUST reconcile signals locally before acting on
 * consent (see `reconcileSignals`).
 */
export interface UniversalConsentRecord {
  status: string;
  consentPreferences: UniversalConsentPreferences | null;
  consentMode: string | null;
  ccpaOptout: boolean;
  platform: string | null;
  policyName: string | null;
  configVersion: string | null;
  updatedAt: string | null;
  // Raw IAB signals — passed through by the server, reconciled by the client.
  gpc: boolean;
  tcfString: string | null;
  gppString: string | null;
}

/**
 * Apply mandatory client-side signal reconciliation to a cookie-options map.
 *
 * The Universal Consent API returns raw, unreconciled data. When an opt-out signal applies —
 * either the record's stored `gpc` (recorded on the web, where GPC exists) or this device's
 * live ad-tracking signal — every SDK MUST suppress non-essential categories locally,
 * regardless of what the stored map says. The stored map may still show `marketing: true`, and
 * a client that naively trusts those booleans would fire marketing tags for an opted-out user.
 *
 * Suppression is one-directional. A signal may only turn categories OFF; it never turns one on.
 * Ad-tracking permission is not consent to marketing categories, and an unreadable signal is
 * not a choice at all, so neither state modifies the stored map.
 *
 * @param cookieOptions The raw stored `{ categoryKey: boolean }` map.
 * @param suppress Whether an opt-out signal applies (device signal, stored GPC, or both).
 * @param essentialKeys Category keys that are essential / always-on and never suppressed.
 */
export function reconcileSignals(
  cookieOptions: Record<string, boolean>,
  suppress: boolean,
  essentialKeys: Set<string>,
): Record<string, boolean> {
  if (!suppress) return cookieOptions;

  const reconciled: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(cookieOptions)) {
    reconciled[key] = essentialKeys.has(key) ? enabled : false;
  }
  return reconciled;
}
