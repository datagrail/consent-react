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
  if (prefs === null) return false;
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
  if (saved !== null) return saved;
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
  if (record === null) return null;

  const prefs = record.consentPreferences;
  if (prefs === null) return record;

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
  assertUniversalConsentEnabled();

  const record = await fetchUniversalConsent(identifier, apiKey, trackingSignal);
  const cookieOptions = record?.consentPreferences?.cookieOptions;

  // An empty map carries no category state to apply. Saving it would store preferences with
  // nothing in them, and because isCategoryEnabled() defaults an unknown key to false, that
  // reads back as a blanket opt-out the user never made — while also hiding the banner.
  if (!cookieOptions || Object.keys(cookieOptions).length === 0) return false;

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
  return true;
}

/**
 * Register a user identifier and sync their consent across devices.
 *
 * READS then WRITES, matching the web, iOS, and Android SDKs. Rehydrating first means the write
 * persists the user's actual cross-device state rather than clobbering a richer server-side
 * record with whatever this fresh install happens to hold locally. A read failure does not block
 * the write — someone who just answered the banner still needs their choice saved.
 *
 * The SDK computes the user hash and reconciles signals on-device, but does NOT compute the
 * HMAC. It invokes `getSignature` — which calls your own backend — to obtain
 * `{ signature, keyId, timestamp }`. The shared secret never touches the device.
 */
export async function setUserIdentifier(
  identifier: string,
  options: {
    apiKey: string;
    getSignature: SignatureProvider;
    trackingSignal?: ATTStatus;
  },
): Promise<void> {
  assertUniversalConsentEnabled();

  const { apiKey, getSignature } = options;
  const trackingSignal = options.trackingSignal ?? readTrackingSignal();

  try {
    await rehydrateFromUniversalConsent(identifier, apiKey, trackingSignal);
  } catch (error: unknown) {
    // Swallowed deliberately — see the read-then-write note above. A VALIDATION_ERROR is the
    // exception: an empty identifier or a missing consentProjectId would fail the write the same
    // way, so failing fast here beats a confusing error from the second call.
    if (error instanceof ConsentError && error.code === 'VALIDATION_ERROR') throw error;
  }

  const current = getCategories();
  const rawMap: Record<string, boolean> = {};
  for (const option of current?.cookieOptions ?? []) {
    rawMap[option.gtmKey] = option.isEnabled;
  }

  const essentialKeys = new Set(ConsentResolver.getEssentialCategories(currentConfig!));
  const universalPrefs: UniversalConsentPreferences = {
    isCustomised: current?.isCustomised ?? false,
    cookieOptions: reconcileSignals(
      rawMap,
      signalSuppressesNonEssential(trackingSignal),
      essentialKeys,
    ),
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
