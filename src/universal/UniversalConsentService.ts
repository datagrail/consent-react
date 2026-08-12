import type { ConsentConfig } from '../types';
import { ConsentError } from '../types';
import type { NetworkService } from '../network/NetworkService';
import { generateUuidV4 } from '../storage/uuid';
import { computeUserHash } from './userHash';
import type {
  SignatureProvider,
  UniversalConsentPreferences,
  UniversalConsentRecord,
} from './types';

const PLATFORM = 'react-native';

/**
 * Raw wire shape of a `GET /universal_consent` response. snake_case, mirroring the config
 * endpoint's convention — parsed into the camelCase {@link UniversalConsentRecord}.
 */
interface RawUniversalConsentRecord {
  status?: string;
  consent_preferences?: {
    isCustomised?: boolean;
    cookieOptions?: Record<string, boolean>;
  } | null;
  consent_mode?: string | null;
  ccpa_optout?: boolean;
  platform?: string | null;
  policy_name?: string | null;
  config_version?: string | null;
  updated_at?: string | null;
  gpc?: boolean;
  tcf_string?: string | null;
  gpp_string?: string | null;
}

/**
 * Reads and writes the Universal Consent store.
 *
 * Returns RAW, UNRECONCILED records — the server never computes an effective consent state.
 * Callers must apply signal reconciliation before acting on what comes back (see
 * `reconcileSignals`).
 */
export class UniversalConsentService {
  constructor(private readonly network: NetworkService) {}

  /**
   * Universal Consent base URL. This endpoint is a CloudFront behavior, NOT a Rails route, so
   * it has NO `/api/v1/` prefix.
   */
  private static baseUrl(config: ConsentConfig): string {
    return `https://${config.privacyDomain}/universal_consent`;
  }

  private static requireProjectId(config: ConsentConfig): string {
    const projectId = config.consentProjectId;
    if (!projectId) {
      throw new ConsentError(
        'VALIDATION_ERROR',
        'consentProjectId is required for universal consent',
      );
    }
    return projectId;
  }

  /**
   * Read a user's Universal Consent record for cross-device rehydration.
   *
   * `GET /universal_consent?customer_id=..&user_hash=..` with an `X-DG-Api-Key` header. Reads
   * are unsigned — only writes carry an HMAC.
   *
   * @returns the parsed record, or `null` when the server responds `{ "status": "not_found" }`.
   *   `null` means "no signal" — it is NOT an opt-out.
   * @throws ConsentError on network or parse failure.
   */
  async get(
    config: ConsentConfig,
    identifier: string,
    apiKey: string,
  ): Promise<UniversalConsentRecord | null> {
    const projectId = UniversalConsentService.requireProjectId(config);
    const userHash = await computeUserHash(config.dgCustomerId, projectId, identifier);

    const params = new URLSearchParams({
      customer_id: config.dgCustomerId,
      user_hash: userHash,
    });
    const url = `${UniversalConsentService.baseUrl(config)}?${params.toString()}`;

    const response = await this.network.request({
      url,
      method: 'GET',
      headers: { 'X-DG-Api-Key': apiKey },
    });

    // NetworkService resolves on any status — it only rejects on transport failure — so a
    // non-2xx has to be checked here or a 500's error body would be parsed as a record.
    if (response.status < 200 || response.status >= 300) {
      throw new ConsentError(
        'NETWORK_ERROR',
        `Universal consent read failed with status ${response.status}`,
      );
    }

    let raw: RawUniversalConsentRecord;
    try {
      raw = JSON.parse(response.data) as RawUniversalConsentRecord;
    } catch {
      throw new ConsentError('PARSE_ERROR', 'Failed to parse universal consent response');
    }

    // A miss is `{"status":"not_found"}` with HTTP 200, not a 404. The global kill switch
    // produces the same response, so anything that is not an explicit "found" is a miss.
    if (raw.status !== 'found') return null;

    return {
      status: raw.status,
      consentPreferences: raw.consent_preferences
        ? {
            isCustomised: raw.consent_preferences.isCustomised ?? false,
            cookieOptions: raw.consent_preferences.cookieOptions ?? {},
          }
        : null,
      consentMode: raw.consent_mode ?? null,
      ccpaOptout: raw.ccpa_optout ?? false,
      platform: raw.platform ?? null,
      policyName: raw.policy_name ?? null,
      configVersion: raw.config_version ?? null,
      updatedAt: raw.updated_at ?? null,
      gpc: raw.gpc ?? false,
      tcfString: raw.tcf_string ?? null,
      gppString: raw.gpp_string ?? null,
    };
  }

  /**
   * Write a user's Universal Consent preferences for cross-device retrieval.
   *
   * `POST /universal_consent`. The SDK does NOT compute the HMAC — it invokes the customer's
   * `getSignature` provider (which calls the customer's own backend) and attaches the result as
   * `X-DG-Signature` / `X-DG-Timestamp` (unix seconds) / `X-DG-Key-Id` headers, plus a
   * per-write `X-DG-Nonce` for replay protection. The shared secret never touches the device.
   *
   * @param ccpaOptout the user's CCPA/US do-not-sell choice, only written when the
   *   `universalConsent.syncOptout` flag is enabled. NOT derived from the device's ad-tracking
   *   signal — that signal is narrower than a do-not-sell choice, so React Native has no source
   *   for this value and passes `false`, matching iOS and Android.
   */
  async save(
    config: ConsentConfig,
    identifier: string,
    preferences: UniversalConsentPreferences,
    apiKey: string,
    ccpaOptout: boolean,
    getSignature: SignatureProvider,
  ): Promise<void> {
    const projectId = UniversalConsentService.requireProjectId(config);
    const userHash = await computeUserHash(config.dgCustomerId, projectId, identifier);

    // Ask the customer's backend to sign. The secret never leaves their backend.
    const sig = await getSignature(config.dgCustomerId, userHash);

    const body = JSON.stringify({
      customer_id: config.dgCustomerId,
      user_hash: userHash,
      consent_preferences: {
        isCustomised: preferences.isCustomised,
        cookieOptions: preferences.cookieOptions,
      },
      consent_mode: config.consentMode,
      // syncOptout is a feature gate, NOT the opt-out value itself.
      ccpa_optout: config.universalConsent?.syncOptout === true && ccpaOptout,
      platform: PLATFORM,
      policy_name: config.consentPolicy.name,
      config_version: config.version,
    });

    const response = await this.network.request({
      url: UniversalConsentService.baseUrl(config),
      method: 'POST',
      body,
      headers: {
        'X-DG-Api-Key': apiKey,
        'X-DG-Signature': sig.signature,
        'X-DG-Timestamp': String(sig.timestamp),
        'X-DG-Key-Id': sig.keyId,
        'X-DG-Nonce': generateUuidV4(),
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ConsentError(
        'NETWORK_ERROR',
        `Universal consent write failed with status ${response.status}`,
      );
    }
  }
}
