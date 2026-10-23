/**
 * Decision times for the Universal Consent stale-re-sync guard (TRUST-3225, the React Native port of
 * consent-banner TRUST-3154). A decision time is WHEN the user made a consent choice, in unix seconds
 * (the resolution `decision_ts` has on the wire). The edge's per-category merge is decision-time
 * last-writer-wins, so a write must carry the time of the choice, never the time of the request.
 */

/** Unix seconds now. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * How far ahead of this device's clock a decision time may be before it is treated as bogus. Matches
 * the edge's own future clamp (now + 300 s).
 */
export const DECISION_TS_FUTURE_TOLERANCE_SECONDS = 300;

/**
 * How far ahead a STORED decision time may be and still be read back. An adopted record's time can
 * already sit at the edge's clamp, and the monotonic stamp of a choice made right after it must land
 * beyond that and still be readable, or the fresh choice would read as unknown and lose to the record
 * it follows. Twice the clamp leaves that room and still rejects a stamp from a since-corrected clock.
 */
export const DECISION_TS_STORED_TOLERANCE_SECONDS = 2 * DECISION_TS_FUTURE_TOLERANCE_SECONDS;

/**
 * A record's `updated_at` (ISO-8601, the latest `decision_ts` across all of the record's per-category
 * registers) as unix seconds, or `null` when it is absent, unparseable, negative, or beyond the
 * future tolerance. An unknown time is the revocation-safe value: it never out-ranks anything.
 */
export function recordDecisionTs(updatedAt: string | null | undefined): number | null {
  if (typeof updatedAt !== 'string') {
    return null;
  }
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms) || ms < 0) {
    return null;
  }
  const seconds = Math.floor(ms / 1000);
  return seconds <= nowSeconds() + DECISION_TS_FUTURE_TOLERANCE_SECONDS ? seconds : null;
}
