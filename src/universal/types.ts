/**
 * Signature material returned by the customer-provided `getSignature` callback.
 *
 * The DataGrail SDK never computes the HMAC itself — the shared secret lives only on the
 * customer's backend and at the DataGrail edge. The customer's backend computes
 * `HMAC-SHA256(rawSecretBytes, "{customerId}:{userHash}:{timestamp}:{nonce}")` as lowercase hex,
 * where `rawSecretBytes` is the 64-hex shared secret decoded to its raw bytes (those bytes are the
 * HMAC key — the hex string itself is NOT the key), and `{nonce}` is the fresh per-write 128-bit
 * value sent in the `X-DG-Nonce` header. It returns the resulting signature together with the key
 * id (identifies which secret was used, for rotation) and the timestamp (unix seconds) that was
 * signed over. The SDK attaches these as request headers on the Universal Consent write.
 */
export interface UniversalConsentSignature {
  /** Hex-encoded HMAC-SHA256 signature computed by the customer backend. */
  signature: string;
  /** Identifier of the HMAC secret used (supports key rotation). */
  keyId: string;
  /** Unix timestamp in seconds that the signature was computed over. */
  timestamp: number;
}

/**
 * Customer-provided signature provider, invoked by the SDK immediately before a Universal
 * Consent write. The SDK passes the `customerId` and computed `userHash` so the customer's
 * backend can build the exact string-to-sign the edge will recompute.
 */
export type SignatureProvider = (
  customerId: string,
  userHash: string,
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
