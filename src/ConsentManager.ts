import type {
  ATTStatus,
  DataGrailConfig,
  ConsentConfig,
  ConsentPreferences,
  CategoryConsent,
  ConsentChangeListener,
  Unsubscribe,
} from './types';
import { ConsentError } from './types';
import { StorageService } from './storage/StorageService';
import { NetworkService } from './network/NetworkService';
import { OfflineQueue } from './network/OfflineQueue';
import { ConfigService } from './config/ConfigService';
import { ConsentResolver } from './consent/ConsentResolver';
import { ConsentEventEmitter } from './consent/EventEmitter';
import { UniversalConsentService } from './universal/UniversalConsentService';
import { reconcileSignals } from './universal/types';
import type {
  SignatureProvider,
  UniversalConsentPreferences,
  UniversalConsentRecord,
} from './universal/types';
import { readTrackingSignal } from './platform/trackingSignal';
import { signalSuppressesNonEssential } from './platform/attShared';
import { Platform } from 'react-native';
import { CONFIG_SCHEMA_VERSION, SDK_VERSION } from './version';

// Internal state — module-level singleton pattern (matches native SDKs)
let initialized = false;
let currentConfig: ConsentConfig | null = null;
let storageService: StorageService | null = null;
let networkService: NetworkService | null = null;
let offlineQueue: OfflineQueue | null = null;
let configService: ConfigService | null = null;
let universalConsentService: UniversalConsentService | null = null;
let eventEmitter: ConsentEventEmitter = new ConsentEventEmitter();

/**
 * Initialize the DataGrail Consent SDK.
 * Must be called before any other method.
 */
export async function initialize(config: DataGrailConfig): Promise<void> {
  // 1. Validate config
  if (!config.configUrl || !config.configUrl.startsWith('https://')) {
    throw new ConsentError('INVALID_CONFIGURATION', 'configUrl must be a valid HTTPS URL');
  }

  // 2. Create StorageService
  storageService = new StorageService();

  // 3. Create NetworkService + OfflineQueue
  networkService = new NetworkService();
  offlineQueue = new OfflineQueue(storageService, networkService);

  // 4. Create ConfigService and fetch config
  configService = new ConfigService(networkService, storageService);
  universalConsentService = new UniversalConsentService(networkService);
  currentConfig = await configService.fetchConfig(config.configUrl);

  // 5. Load/resolve consent state (store version for future comparisons)
  const savedPrefs = storageService.loadPreferences();
  const savedVersion = storageService.loadConfigVersion();
  const { preferences } = ConsentResolver.resolve(currentConfig, savedPrefs, savedVersion);

  // If no saved prefs, store the defaults so isCategoryEnabled works immediately
  if (savedPrefs === null) {
    storageService.savePreferences(preferences);
    storageService.saveConfigVersion(currentConfig.version);
  }

  // 6. Set initialized
  initialized = true;

  // 7. Retry pending requests (non-blocking)
  offlineQueue.drain().catch(() => {
    // Swallow — fire and forget
  });
}

export function needsConsent(): boolean {
  assertInitialized();

  if (!currentConfig!.showBanner) {
    return false;
  }

  // Auto-persisted defaults (written by initialize()) don't count as consent —
  // only an explicit savePreferences/acceptAll/rejectAll does.
  if (!storageService!.hasUserConsented()) {
    return true;
  }

  // Version mismatch triggers reconsent
  const savedVersion = storageService!.loadConfigVersion();
  return savedVersion !== currentConfig!.version;
}

export function showBanner(): void {
  assertInitialized();
  // This is a UI trigger — delegates to the Banner component
  // The actual banner display is handled by the UI layer (not our scope)
}

export function isCategoryEnabled(category: string): boolean {
  assertInitialized();
  const prefs = storageService!.loadPreferences();
  if (prefs === null) {
    return false;
  }
  const option = prefs.cookieOptions.find((opt) => opt.gtmKey === category);
  return option?.isEnabled ?? false;
}

export function getPreferences(): ConsentPreferences | null {
  assertInitialized();
  return storageService!.loadPreferences();
}

export function getCategories(): ConsentPreferences | null {
  assertInitialized();
  const saved = storageService!.loadPreferences();
  if (saved !== null) {
    return saved;
  }
  return ConsentResolver.getDefaults(currentConfig!);
}

export function getConfig(): ConsentConfig | null {
  return currentConfig;
}

export async function savePreferences(prefs: ConsentPreferences): Promise<void> {
  assertInitialized();

  // Save to storage
  storageService!.savePreferences(prefs);
  storageService!.saveConfigVersion(currentConfig!.version);
  storageService!.setUserConsented(true);

  // Emit event
  eventEmitter.emit(prefs);

  // POST to backend
  const consentId = storageService!.getOrCreateUniqueId();
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    dg_customer_id: currentConfig!.dgCustomerId,
    consent_id: consentId,
    config_version: currentConfig!.version,
    is_customised: prefs.isCustomised,
    cookie_options: prefs.cookieOptions.map((opt) => ({
      gtm_key: opt.gtmKey,
      is_enabled: opt.isEnabled,
    })),
    timestamp,
  });

  const url = `https://${currentConfig!.privacyDomain}/save_preferences`;

  try {
    await networkService!.request({
      url,
      method: 'POST',
      body,
    });
  } catch {
    // On network failure, queue for later
    offlineQueue!.enqueue({ url, method: 'POST', body }, '/save_preferences');
  }
}

export async function acceptAll(): Promise<void> {
  assertInitialized();
  const allCategories = ConsentResolver.getAllCategories(currentConfig!);
  const cookieOptions: CategoryConsent[] = allCategories.map((gtmKey) => ({
    gtmKey,
    isEnabled: true,
  }));

  await savePreferences({
    isCustomised: false,
    cookieOptions,
  });
}

export async function rejectAll(): Promise<void> {
  assertInitialized();
  const allCategories = ConsentResolver.getAllCategories(currentConfig!);
  const essentialCategories = new Set(ConsentResolver.getEssentialCategories(currentConfig!));

  const cookieOptions: CategoryConsent[] = allCategories.map((gtmKey) => ({
    gtmKey,
    isEnabled: essentialCategories.has(gtmKey),
  }));

  await savePreferences({
    isCustomised: false,
    cookieOptions,
  });
}

export function onConsentChanged(listener: ConsentChangeListener): Unsubscribe {
  return eventEmitter.addListener(listener);
}

export function reset(): void {
  if (storageService) {
    storageService.clearAll();
  }
  currentConfig = null;
  universalConsentService = null;
  initialized = false;
  eventEmitter.removeAllListeners();
}

// --- Universal Consent ---

/** Whether cross-device Universal Consent is enabled for the loaded config. */
export function isUniversalConsentEnabled(): boolean {
  return currentConfig?.universalConsent?.enabled === true;
}

function assertUniversalConsentEnabled(): void {
  assertInitialized();
  if (!isUniversalConsentEnabled()) {
    throw new ConsentError(
      'VALIDATION_ERROR',
      'Universal consent is not enabled for this configuration',
    );
  }
}

/**
 * Fetch a user's stored Universal Consent record without changing local state.
 *
 * The returned record has signals already reconciled on-device: when an opt-out signal applies,
 * every non-essential category is forced to `false` regardless of the stored value. Two signals
 * are considered and the more privacy-protective wins — the record's stored `gpc` (recorded on
 * the web, where GPC exists; React Native has no GPC of its own, so this field is the only way
 * that signal reaches the device) and this device's live ad-tracking signal.
 *
 * @returns the reconciled record, or `null` when no record is stored for this user. `null` means
 *   "no signal" — it is NOT an opt-out.
 */
export async function fetchUniversalConsent(
  identifier: string,
  apiKey: string,
  trackingSignal: ATTStatus = readTrackingSignal(),
): Promise<UniversalConsentRecord | null> {
  assertUniversalConsentEnabled();

  const record = await universalConsentService!.get(currentConfig!, identifier, apiKey);
  if (record === null) {
    return null;
  }

  const prefs = record.consentPreferences;
  if (prefs === null) {
    return record;
  }

  const essentialKeys = new Set(ConsentResolver.getEssentialCategories(currentConfig!));
  const reconciled = reconcileSignals(
    prefs.cookieOptions,
    // Either signal suppresses. Neither can re-enable what the other suppressed.
    record.gpc || signalSuppressesNonEssential(trackingSignal),
    essentialKeys,
  );

  return {
    ...record,
    consentPreferences: { ...prefs, cookieOptions: reconciled },
  };
}

/**
 * Rehydrate local consent state from the Universal Consent store.
 *
 * Call this after `initialize()` and BEFORE `needsConsent()` once you know who the user is.
 * `fetchUniversalConsent` reconciles a record and hands it back, but returning it is not the
 * same as applying it — on its own the stored consent stays invisible to `needsConsent()`,
 * `getCategories()` and `isCategoryEnabled()`. This persists the effective state, which is what
 * stops the banner re-prompting someone who already answered on another device.
 *
 * A read MISS writes nothing. "No record" is the absence of a signal, not a denial, so
 * persisting an empty record would both fabricate a choice the user never made and suppress the
 * banner that should collect it.
 *
 * @returns `true` when local state was rehydrated from a stored record, `false` on a miss.
 */
export async function rehydrateFromUniversalConsent(
  identifier: string,
  apiKey: string,
  trackingSignal: ATTStatus = readTrackingSignal(),
): Promise<boolean> {
  return (await rehydrateReturningRawPreferences(identifier, apiKey, trackingSignal)) !== null;
}

/**
 * Rehydrate, and hand back the RAW preferences from the stored record.
 *
 * Same behavior as `rehydrateFromUniversalConsent`, except the return value carries the record's
 * raw preferences (or `null` on a miss) rather than a boolean. `setUserIdentifier` needs this:
 * rehydration deliberately persists the RECONCILED view locally, so a write that sourced its
 * payload from `getCategories()` afterwards would read that suppression back and store it in the
 * cross-device record as though the user had chosen it. Returning the raw map lets the write carry
 * what the user actually consented to.
 *
 * Internal — the public surface keeps the boolean-returning shape.
 */
async function rehydrateReturningRawPreferences(
  identifier: string,
  apiKey: string,
  trackingSignal: ATTStatus,
): Promise<Record<string, boolean> | null> {
  assertUniversalConsentEnabled();

  // Goes to the service directly rather than through fetchUniversalConsent, which returns an
  // already-reconciled record. Both views are needed here: the reconciled one to persist locally,
  // the raw one to hand back for the write.
  const record = await universalConsentService!.get(currentConfig!, identifier, apiKey);
  const rawCookieOptions = record?.consentPreferences?.cookieOptions;

  // An empty map carries no category state to apply. Saving it would store preferences with
  // nothing in them, and because isCategoryEnabled() defaults an unknown key to false, that
  // reads back as a blanket opt-out the user never made — while also hiding the banner.
  if (!rawCookieOptions || Object.keys(rawCookieOptions).length === 0) {
    return null;
  }

  // Local state gets the RECONCILED view — either signal suppresses. The stored `gpc` came from
  // the web, the tracking signal from this device; neither can re-enable what the other suppressed.
  const cookieOptions = reconcileSignals(
    rawCookieOptions,
    record!.gpc || signalSuppressesNonEssential(trackingSignal),
    new Set(ConsentResolver.getEssentialCategories(currentConfig!)),
  );

  const preferences: ConsentPreferences = {
    // A record that came back at all represents an answered prompt, so the rehydrated state is
    // customised even if the writer left the flag false.
    isCustomised: true,
    cookieOptions: Object.entries(cookieOptions).map(([gtmKey, isEnabled]) => ({
      gtmKey,
      isEnabled,
    })),
  };

  storageService!.savePreferences(preferences);
  // Stamp the CURRENT config version, not the record's. needsConsent() compares the stored
  // version against the running config, so carrying a stale version over from the writing
  // device would re-prompt immediately and undo the rehydration we just did.
  storageService!.saveConfigVersion(currentConfig!.version);
  // needsConsent() gates on this flag rather than on preferences merely existing (initialize()
  // auto-persists defaults). Without it the rehydrated state would apply to category reads but
  // the banner would still show, which is the bug this method exists to fix.
  storageService!.setUserConsented(true);

  eventEmitter.emit(preferences);
  return rawCookieOptions;
}

/**
 * Register a user identifier and sync their consent across devices.
 *
 * READS then WRITES. Rehydrating first applies any stored record to LOCAL state, so a choice the
 * same person made on the web or another device is honored here. The write then carries the
 * user's CURRENT LOCAL choice (sync-on-change) — it NEVER re-POSTs the record it just fetched,
 * which the edge already holds and which would discard a choice made on this device. When a FOUND
 * record meets no local change (a fresh install that only adopted it), the call adopts-WITHOUT-
 * POST and returns without writing. A read MISS with local state still writes — it seeds the first
 * cross-device record. A read FAILURE, by contrast, rejects WITHOUT writing: the server never
 * merges, so overwriting a record we could not read would silently erase the user's real
 * cross-device choice (the TRUST-2491 corruption class). Callers should retry, which re-reads
 * first. Cross-device conflict resolution is the edge's job, not the SDK's.
 *
 * The read applies the tracking signal to LOCAL state; the write carries the user's RAW
 * preferences. The store holds raw choices and the server never merges, so a device signal must
 * never change what is stored cross-device — otherwise opening the app with ATT denied would erase
 * a marketing opt-in the user made on the web, for every device on their identifier, and a later
 * session without the signal would read it back as a revocation they never made. Suppression is a
 * read-time view (see `fetchUniversalConsent`).
 *
 * Not safe to call concurrently for the same identifier. This is a read-then-write against a
 * shared remote record with no in-flight guard, so two overlapping calls can interleave — the one
 * that reads first but writes second overwrites the other's more current preferences. Callers must
 * serialize their own calls (most integrations call this once per login; guard against
 * double-firing effects or retry-after-stall races).
 *
 * The SDK computes the user hash and reconciles signals on-device, mints the timestamp and nonce,
 * and builds the string-to-sign, but does NOT compute the HMAC. It invokes `getSignature` — which
 * calls your own backend — with that payload and expects back `{ signature, keyId }`. The shared
 * secret never touches the device. Omitting `getSignature` performs a limited, API-key-only write.
 */
export async function setUserIdentifier(
  identifier: string,
  options: {
    apiKey: string;
    getSignature?: SignatureProvider;
    trackingSignal?: ATTStatus;
  },
): Promise<void> {
  assertUniversalConsentEnabled();

  const { apiKey, getSignature } = options;
  const trackingSignal = options.trackingSignal ?? readTrackingSignal();

  // Capture the user's RAW local choice BEFORE the rehydrate below overwrites storage with the
  // signal-reconciled view. Only an EXPLICIT choice counts as a local change — initialize()
  // auto-persists config defaults, and hasUserConsented() is the flag that tells the two apart.
  const hadLocalChoice = storageService!.hasUserConsented();
  const localChoice = storageService!.loadPreferences();

  // Read first, then write. A genuine MISS comes back as `null` (no remote record exists — it is
  // safe to seed the record from local state below). A read FAILURE throws, and MUST propagate:
  // a rich remote record may exist that we simply could not read, and the server never merges — a
  // write is a full overwrite. Sourcing the payload from local state on a failure (a prior
  // rehydrate persisted the signal-SUPPRESSED view, or nothing ran and we hold bare config
  // defaults) would clobber that unread record for every device on the identifier, with no error
  // surfaced since the write itself would succeed. That is the cross-device corruption class
  // TRUST-2491 fixed on the read-SUCCESS path; do not reopen it through the read-FAILURE branch.
  // Surfacing the error lets the caller retry, which re-reads first. (A VALIDATION_ERROR — empty
  // identifier or missing consentProjectId — propagates the same way and fails fast.)
  const rawFromRecord = await rehydrateReturningRawPreferences(identifier, apiKey, trackingSignal);

  // Adopt-without-POST: a FOUND record with no local change is already applied to local state by
  // the rehydrate above. Re-POSTing it would only echo state the edge already holds — and worse,
  // discard nothing the user chose here only because there was nothing to discard. The edge, not
  // the SDK, resolves cross-device conflicts. (A miss still seeds the first record below.)
  if (rawFromRecord !== null && !hadLocalChoice) {
    return;
  }

  // Write-through the user's CURRENT LOCAL choice (sync-on-change) — NEVER `rawFromRecord`, which
  // would discard a choice the user made on this device before associating their identity. The
  // choice was captured BEFORE rehydrate, so it is RAW and no device signal leaks into the store.
  // On a genuine miss with no explicit choice this still seeds the first record from local state.
  const source = hadLocalChoice && localChoice !== null ? localChoice : getCategories();
  const rawMap: Record<string, boolean> = {};
  for (const option of source?.cookieOptions ?? []) {
    rawMap[option.gtmKey] = option.isEnabled;
  }

  const universalPrefs: UniversalConsentPreferences = {
    isCustomised: source?.isCustomised ?? false,
    cookieOptions: rawMap,
  };

  await universalConsentService!.save(
    currentConfig!,
    identifier,
    universalPrefs,
    apiKey,
    // NOT derived from the tracking signal. `ccpa_optout` records a CCPA/US do-not-sell choice;
    // the device ad-tracking signal is a narrower ad-personalization signal, and treating one as
    // the other would write a legal opt-out the user never made. React Native has no source for
    // this value, matching iOS and Android.
    false,
    getSignature,
  );
}

export function hasUserConsent(): boolean {
  assertInitialized();
  return storageService!.hasUserConsented();
}

export async function retryPendingRequests(): Promise<{ success: number; failed: number }> {
  assertInitialized();
  return offlineQueue!.drain();
}

export async function trackBannerShown(): Promise<void> {
  assertInitialized();

  const consentId = storageService!.getOrCreateUniqueId();
  const timestamp = new Date().toISOString();
  const params = new URLSearchParams({
    dg_customer_id: currentConfig!.dgCustomerId,
    consent_id: consentId,
    config_version: currentConfig!.version,
    timestamp,
    library_version: SDK_VERSION,
    // Bare OS version string, no platform-name prefix — matches the native
    // SDKs' os_version shape (UIDevice.systemVersion on iOS,
    // Build.VERSION.RELEASE on Android). `Platform.Version` is the API level
    // integer on Android, not the release string, so it needs the
    // `constants.Release` field instead. Falls back to 'unknown' rather than
    // emitting the literal 'undefined' on a platform without a version (e.g.
    // RN Web), and `?.` guards a jest Platform mock that omits `constants`.
    os_version:
      (Platform.OS === 'android' ? Platform.constants?.Release : Platform.Version)?.toString() ??
      'unknown',
    schema_version: CONFIG_SCHEMA_VERSION,
  });

  const url = `https://${currentConfig!.privacyDomain}/save_open?${params.toString()}`;

  try {
    await networkService!.request({ url, method: 'GET' });
  } catch {
    // Non-critical — swallow errors for analytics
  }
}

function assertInitialized(): void {
  if (!initialized) {
    throw new ConsentError('NOT_INITIALIZED', 'SDK not initialized. Call initialize() first.');
  }
}
