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

/**
 * Destructive full wipe: clears ALL stored state (consent choice, unique id, config cache, pending
 * queue, identity binding) and de-initializes the SDK. For logout, use `clearUserIdentifier()`,
 * which is non-destructive.
 */
export function reset(): void {
  if (storageService) {
    // clearAll() also removes the Universal Consent identity binding (BOUND_USER_HASH lives in
    // the same MMKV instance).
    storageService.clearAll();
  }
  currentConfig = null;
  universalConsentService = null;
  initialized = false;
  eventEmitter.removeAllListeners();
}

// --- Universal Consent ---

/**
 * Return local consent to NEUTRAL — what a first-time visitor sees on a fresh install of this
 * device: the explicit choice is removed, the config's defaults are persisted exactly as
 * `initialize()` does when nothing is saved, and the banner shows again (`needsConsent()` true,
 * `hasUserConsent()` false). Fires the consent-changed listener with the now-effective defaults,
 * the same way rehydration does, so the host can re-gate its SDKs.
 *
 * The CCPA opt-out flag (`setCcpaOptout`) is part of the choice and returns to `false`.
 *
 * Local only: no network call, and the unique id, config cache, config version and offline queue
 * are untouched. Does NOT touch the identity binding — callers decide that.
 */
function returnToNeutral(): void {
  storageService!.clearUserChoice();
  // Same default path initialize() takes when no preferences are saved (resolve → getDefaults).
  const { preferences } = ConsentResolver.resolve(currentConfig!, null, null);
  storageService!.savePreferences(preferences);
  storageService!.saveConfigVersion(currentConfig!.version);
  eventEmitter.emit(preferences);
}

/**
 * Log the current user out of Universal Consent and return this device to NEUTRAL.
 *
 * Call this on logout. The SDK cannot detect a logout it is not told about, so without this call
 * the previous user's consent keeps applying on this device, and a choice made after that
 * unannounced logout is treated as belonging to the still-bound identity.
 *
 * Clears the device's identity binding and removes the stored explicit consent choice (including
 * the CCPA opt-out set by `setCcpaOptout`, which returns to `false`), so reads
 * return the config's defaults as on a fresh install: the banner shows again, `needsConsent()` is
 * `true` and `hasUserConsent()` is `false`. The consent-changed listener fires with those defaults.
 *
 * Non-destructive, unlike `reset()`: no network call, the user's server-side Universal Consent
 * record is NOT modified or deleted, and the device unique id, cached config, config version and
 * pending offline queue are kept. The SDK stays initialized. Idempotent and safe to call when no
 * user is bound. Like `reset()` it does not throw before `initialize()`.
 */
export function clearUserIdentifier(): void {
  if (!storageService) {
    return;
  }
  storageService.clearBoundUserHash();
  // The CCPA opt-out belongs to the logged-out user too (TRUST-2591). returnToNeutral() clears it
  // as part of the choice; this also covers a call before initialize().
  storageService.clearCcpaOptout();
  if (initialized && currentConfig) {
    returnToNeutral();
  }
}

/**
 * Record the user's explicit CCPA/CPRA "Do Not Sell or Share My Personal Information" (DNSMPI)
 * choice (TRUST-2591).
 *
 * Source of truth on React Native is the host app: call this from your own DNSMPI control. There
 * is no OS-level DNSMPI signal on iOS or Android, so the SDK never detects or derives this value —
 * not from marketing consent, the ad-tracking signal (ATT / Android ad-ID opt-out), GPC or DNT —
 * and it does not read the deprecated IAB `IABUSPrivacy_String` key.
 *
 * Persists the flag on the device (`getCcpaOptout()` reads it back). It does NOT change any
 * category preference, does not count as a consent choice for `needsConsent()` /
 * `hasUserConsent()`, and does not fire the consent-changed listener.
 *
 * Cross-device write-through: pass `sync` with the logged-in user's identifier and credentials and
 * the flag is written to their Universal Consent record together with the current local category
 * choice, through the same write `setUserIdentifier` uses — but only when Universal Consent is
 * enabled, `universalConsent.syncOptout` is on, the device is bound to that identifier (a
 * `setUserIdentifier` call for it succeeded), and the user has an explicit local category choice
 * (config defaults are never written as one). Otherwise the change is local only and rides the
 * next Universal Consent write. A write failure rejects, like `setUserIdentifier`; the local flag
 * stays set.
 */
export async function setCcpaOptout(
  optedOut: boolean,
  sync?: {
    identifier: string;
    apiKey?: string;
    getSignature?: SignatureProvider;
  },
): Promise<void> {
  assertInitialized();
  storageService!.saveCcpaOptout(optedOut);

  if (
    sync === undefined ||
    !isUniversalConsentEnabled() ||
    currentConfig!.universalConsent?.syncOptout !== true
  ) {
    return;
  }

  const boundHash = storageService!.loadBoundUserHash();
  if (boundHash === null) {
    return;
  }
  const userHash = await universalConsentService!.userHash(currentConfig!, sync.identifier);
  const localChoice = storageService!.loadPreferences();
  if (userHash !== boundHash || !storageService!.hasUserConsented() || localChoice === null) {
    return;
  }

  const apiKey = resolveUniversalConsentApiKey(sync.apiKey);

  const rawMap: Record<string, boolean> = {};
  for (const option of localChoice.cookieOptions) {
    rawMap[option.gtmKey] = option.isEnabled;
  }
  await universalConsentService!.save(
    currentConfig!,
    sync.identifier,
    { isCustomised: localChoice.isCustomised, cookieOptions: rawMap },
    apiKey,
    optedOut,
    sync.getSignature,
  );
}

/**
 * The user's CCPA "Do Not Sell or Share" choice on this device: `true` only after an explicit
 * `setCcpaOptout(true)` or adopting a Universal Consent record that carries it. Defaults to `false`.
 * On React Native the local flag is the only source (there is no native DNSMPI signal).
 */
export function getCcpaOptout(): boolean {
  assertInitialized();
  return storageService!.loadCcpaOptout();
}

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
 * Resolve the edge API key for a Universal Consent call (TRUST-2603). An explicit value passed by
 * the host wins (existing integrations behave exactly as before); otherwise fall back to
 * `universalConsent.apiKey` from config.json, which lets the key rotate server-side with no client
 * release. Throws a VALIDATION_ERROR when neither is present. Call only after the enabled check, so
 * `currentConfig` is loaded.
 */
function resolveUniversalConsentApiKey(explicit?: string): string {
  const apiKey = explicit ?? currentConfig?.universalConsent?.apiKey;
  if (!apiKey) {
    throw new ConsentError(
      'VALIDATION_ERROR',
      'A Universal Consent API key is required: pass it explicitly or set universalConsent.apiKey in config.json',
    );
  }
  return apiKey;
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
  apiKey?: string,
  trackingSignal: ATTStatus = readTrackingSignal(),
): Promise<UniversalConsentRecord | null> {
  assertUniversalConsentEnabled();
  const resolvedApiKey = resolveUniversalConsentApiKey(apiKey);

  const record = await universalConsentService!.get(currentConfig!, identifier, resolvedApiKey);
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
  apiKey?: string,
  trackingSignal: ATTStatus = readTrackingSignal(),
): Promise<boolean> {
  assertUniversalConsentEnabled();
  const resolvedApiKey = resolveUniversalConsentApiKey(apiKey);
  const { rawCookieOptions } = await rehydrateReturningRawPreferences(
    identifier,
    resolvedApiKey,
    trackingSignal,
    false,
  );
  return rawCookieOptions !== null;
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
 * `recordFound` is `true` whenever the server returned a record, even a signal-only one whose
 * `consentPreferences` is absent (`null`) — `rawCookieOptions` is `null` in that case, exactly as
 * on a miss. A record whose `consentPreferences` block is PRESENT is an answered choice and is
 * applied, even when its `cookieOptions` map is empty (essential-only, TRUST-2961): `rawCookieOptions`
 * is that (possibly empty) map, not `null`. `setUserIdentifier` needs the distinction on a login.
 *
 * `recordCcpaOptout` is the found record's stored `ccpa_optout` (`null` on a miss). When the record's
 * consent choice is applied, the local CCPA opt-out flag is set to it too (TRUST-2591): the record is
 * authoritative for the stored choice. On a found record with an absent choice nothing is applied
 * here; `setUserIdentifier` decides.
 *
 * `fillFromNeutral` (login only, TRUST-2902): categories the record does not mention take the
 * neutral value (the config default, essential on) rather than being left out, so no category
 * reads as the prior user's value or as an implicit `false`.
 *
 * Internal — the public surface keeps the boolean-returning shape.
 */
async function rehydrateReturningRawPreferences(
  identifier: string,
  apiKey: string,
  trackingSignal: ATTStatus,
  fillFromNeutral: boolean,
): Promise<{
  recordFound: boolean;
  rawCookieOptions: Record<string, boolean> | null;
  recordCcpaOptout: boolean | null;
}> {
  assertUniversalConsentEnabled();

  // Goes to the service directly rather than through fetchUniversalConsent, which returns an
  // already-reconciled record. Both views are needed here: the reconciled one to persist locally,
  // the raw one to hand back for the write.
  const record = await universalConsentService!.get(currentConfig!, identifier, apiKey);

  // ABSENT consent_preferences — a miss (no record), or a found signal-only record — carries no
  // answered choice, so there is nothing to apply. A PRESENT consent_preferences block IS an
  // answered choice even when its cookieOptions map is empty (the user accepted essential-only):
  // TRUST-2961 — only a null/absent block, not an empty map, is "no choice". This matches iOS and
  // web, and stops re-prompting a user who already answered essential-only on another device.
  if (!record?.consentPreferences) {
    return {
      recordFound: record !== null,
      rawCookieOptions: null,
      recordCcpaOptout: record?.ccpaOptout ?? null,
    };
  }
  const rawCookieOptions = record.consentPreferences.cookieOptions ?? {};

  // Local state gets the RECONCILED view — either signal suppresses. The stored `gpc` came from
  // the web, the tracking signal from this device; neither can re-enable what the other suppressed.
  const essentialKeys = new Set(ConsentResolver.getEssentialCategories(currentConfig!));
  const reconciled = reconcileSignals(
    rawCookieOptions,
    record!.gpc || signalSuppressesNonEssential(trackingSignal),
    essentialKeys,
  );

  // On a login the record REPLACES local state: start from the neutral defaults (never the prior
  // local value) and overlay what the record carries. Essential categories stay on.
  let cookieOptions = reconciled;
  if (fillFromNeutral) {
    cookieOptions = {};
    for (const option of ConsentResolver.getDefaults(currentConfig!).cookieOptions) {
      cookieOptions[option.gtmKey] = option.isEnabled || essentialKeys.has(option.gtmKey);
    }
    Object.assign(cookieOptions, reconciled);
  }

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
  // The record's stored CCPA opt-out replaces the local flag along with the categories (an absent
  // field decodes to false). Not derived from anything: it is the user's recorded DNSMPI choice.
  // Outside a login, adopt it only with the syncOptout gate on: with the gate off the SDK never
  // puts the choice on the record (it always says false), so adopting it would erase a local-only
  // setCcpaOptout(true) on every re-sync. Same rule as the web/iOS/Android SDKs.
  if (fillFromNeutral || currentConfig!.universalConsent?.syncOptout === true) {
    storageService!.saveCcpaOptout(record!.ccpaOptout);
  }

  eventEmitter.emit(preferences);
  return { recordFound: true, rawCookieOptions, recordCcpaOptout: record!.ccpaOptout };
}

/**
 * Register a user identifier and sync their consent across devices.
 *
 * READS then (maybe) WRITES. Rehydrating first applies any stored record to LOCAL state, so a
 * choice the same person made on the web or another device is honored here. A read FAILURE rejects
 * WITHOUT writing: the server never merges, so overwriting a record we could not read would silently
 * erase the user's real cross-device choice (the TRUST-2491 corruption class). Callers should retry,
 * which re-reads first. Cross-device conflict resolution is the edge's job, not the SDK's.
 *
 * Identity binding (TRUST-2902). The device remembers the user hash (never the raw identifier) of
 * the identity it is bound to; every successful call binds it to this identity. What happens next
 * depends on whether this is a LOGIN (the device is unbound, or bound to a different identity) or
 * a RE-SYNC (already bound to this identity, so any local change was made after login):
 *
 * - LOGIN + FOUND record: the record wins. It REPLACES local state — categories it carries take
 *   its (signal-reconciled) value, every other category takes the config default (essential on),
 *   never the prior local value — and nothing is written, even if the device holds an explicit
 *   pre-login choice; that choice is dropped. A present consent_preferences block is an answered
 *   choice even when its cookieOptions map is empty (essential-only, TRUST-2961). A found record
 *   whose consent_preferences is ABSENT (signal-only) returns local state to neutral if anything
 *   explicit or another user's state is stored, and is a no-op otherwise; nothing is written either
 *   way.
 * - LOGIN + MISS + EXPLICIT local choice: the choice is attached — written as this identity's
 *   first record.
 * - LOGIN + MISS + no explicit choice: nothing is written; config defaults are never seeded as a
 *   choice. Local state is left as it is, except that a device still bound to a different identity
 *   (the host skipped `clearUserIdentifier()`) returns to neutral so the previous user's state does
 *   not linger for this one.
 * - RE-SYNC + FOUND record: adopt it when there is no local change; otherwise write the local
 *   choice through (sync-on-change). The write NEVER re-POSTs the fetched record.
 * - RE-SYNC + MISS: an explicit local choice is written; otherwise nothing is.
 *
 * The CCPA opt-out flag (`setCcpaOptout`) follows the same rule: a found record's `ccpa_optout`
 * replaces the local flag (a pre-login value is dropped), and every write carries the raw local
 * flag. A `setCcpaOptout` call on its own is not an explicit category choice, so it never makes a
 * login miss write.
 *
 * "Explicit" means the user actually chose on this device (`savePreferences`, `acceptAll`,
 * `rejectAll`, the banner) — the `hasUserConsented()` flag, not merely stored preferences, since
 * `initialize()` auto-persists defaults — AND the device is not bound to a different identity.
 * When it is, the local state belongs to that other user (possibly their rehydrated record), so it
 * is never explicit for this one.
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
 *
 * What the SDK cannot reliably detect:
 * - A logout it is not told about. The host MUST call `clearUserIdentifier()` on logout.
 * - Whether a pre-login choice was made by the person now logging in or by an earlier user of a
 *   shared device. By design it attaches an explicit choice made on an unbound device when the
 *   login finds no record. It does no heuristic shared-device or shared-account detection.
 * - Two people sharing one account.
 */
export async function setUserIdentifier(
  identifier: string,
  options: {
    apiKey?: string;
    getSignature?: SignatureProvider;
    trackingSignal?: ATTStatus;
  } = {},
): Promise<void> {
  assertUniversalConsentEnabled();

  const apiKey = resolveUniversalConsentApiKey(options.apiKey);
  const { getSignature } = options;
  const trackingSignal = options.trackingSignal ?? readTrackingSignal();

  // Hash first: a VALIDATION_ERROR / NATIVE_ERROR fails fast here with no read, no write and no
  // change to the binding.
  const userHash = await universalConsentService!.userHash(currentConfig!, identifier);
  const boundHash = storageService!.loadBoundUserHash();
  const isResync = boundHash === userHash;
  const boundToOther = boundHash !== null && !isResync;

  // Capture the user's RAW local choice BEFORE the rehydrate below overwrites storage with the
  // signal-reconciled view. Only an EXPLICIT choice may be written: initialize() auto-persists
  // config defaults, and hasUserConsented() is the flag that tells the two apart. State left by a
  // different bound identity is that user's, never an explicit choice for this one.
  const localChoice = storageService!.loadPreferences();
  const hadConsentedFlag = storageService!.hasUserConsented();
  const hasExplicitChoice = hadConsentedFlag && localChoice !== null && !boundToOther;
  // The raw local CCPA opt-out, captured for the same reason: rehydrating a found record replaces it.
  const localCcpaOptout = storageService!.loadCcpaOptout();

  // Read first. A genuine MISS comes back as `null`. A read FAILURE throws, and MUST propagate:
  // a rich remote record may exist that we simply could not read, and the server never merges — a
  // write is a full overwrite. Sourcing the payload from local state on a failure would clobber
  // that unread record for every device on the identifier, with no error surfaced since the write
  // itself would succeed. That is the cross-device corruption class TRUST-2491 fixed on the
  // read-SUCCESS path; do not reopen it through the read-FAILURE branch. Surfacing the error lets
  // the caller retry, which re-reads first. The binding is not touched on this path.
  const {
    recordFound,
    rawCookieOptions: rawFromRecord,
    recordCcpaOptout,
  } = await rehydrateReturningRawPreferences(
    identifier,
    apiKey,
    trackingSignal,
    // A login REPLACES local state with the record; a re-sync keeps today's adopt behavior.
    !isResync,
  );

  if (rawFromRecord === null && recordFound && !isResync) {
    // LOGIN + FOUND signal-only record (consent_preferences ABSENT — TRUST-2961: a present block
    // with an empty map is an answered essential-only choice and is adopted above, not here). There
    // is nothing to adopt, but the record's existence means the device's own state must not be
    // attached either: drop it to neutral if anything explicit or another user's state is stored
    // (no-op, and no listener, when local is already neutral). Never a write.
    if (hadConsentedFlag || boundToOther) {
      returnToNeutral();
    }
    // The record is still authoritative for the stored CCPA opt-out: a pre-login local value is
    // dropped, exactly like the categories.
    storageService!.saveCcpaOptout(recordCcpaOptout === true);
    storageService!.saveBoundUserHash(userHash);
    return;
  }

  if (rawFromRecord !== null) {
    // FOUND: the rehydrate above already adopted the record into local state. On a LOGIN the
    // record wins over any pre-login choice, so nothing is written. On a RE-SYNC with no local
    // change, re-POSTing would only echo state the edge already holds.
    if (!isResync || !hasExplicitChoice) {
      storageService!.saveBoundUserHash(userHash);
      return;
    }
  } else if (!hasExplicitChoice) {
    // MISS with nothing explicit to attach: write nothing — config defaults are not a choice and
    // must not be seeded as one. A device still bound to someone else returns to neutral so their
    // state does not linger for this user; otherwise local state is already the default.
    if (boundToOther) {
      returnToNeutral();
    }
    storageService!.saveBoundUserHash(userHash);
    return;
  }

  // Write the user's CURRENT LOCAL choice: a re-sync's sync-on-change over a found record, or an
  // explicit choice attached to a missing record. NEVER `rawFromRecord`, which would discard the
  // choice made on this device. The choice was captured BEFORE rehydrate, so it is RAW and no
  // device signal leaks into the store.
  const rawMap: Record<string, boolean> = {};
  for (const option of localChoice!.cookieOptions) {
    rawMap[option.gtmKey] = option.isEnabled;
  }

  const universalPrefs: UniversalConsentPreferences = {
    isCustomised: localChoice!.isCustomised,
    cookieOptions: rawMap,
  };

  // The local CCPA opt-out rides the write with the categories. A re-sync rehydrate above replaced
  // the local flag with the record's; put the user's own value back so local matches the write.
  storageService!.saveCcpaOptout(localCcpaOptout);

  await universalConsentService!.save(
    currentConfig!,
    identifier,
    universalPrefs,
    apiKey,
    // The RAW local flag, set only by setCcpaOptout or a record adopt — never derived from the
    // tracking signal, ATT or marketing consent (TRUST-2591). The service applies the syncOptout gate.
    localCcpaOptout,
    getSignature,
  );

  // Bind only after the write succeeds: a failed write must not bind, so a retry is still
  // recognised as a login and re-evaluated from scratch.
  storageService!.saveBoundUserHash(userHash);
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
