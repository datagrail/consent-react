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
import { booleanEntries, reconcileSignals } from './universal/types';
import { recordDecisionTs } from './universal/decisionTs';
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
// Counts setCcpaOptout calls, so a Universal Consent read can tell that the host set the flag while
// it was in flight (that choice is newer than the record and must not be overwritten by it).
let ccpaChoiceSeq = 0;
// Counts logouts (clearUserIdentifier, reset), so a Universal Consent read or write that was in
// flight across one applies nothing and binds nothing: its record belongs to the logged-out user.
let identityEpoch = 0;
// One slot per LOGIN in progress (TRUST-3448): the onBeforeWrite hook folds every write the login
// sends to its identifier into it, and the bind promotes it to the new identity's floor. A login
// that fails drops its slot unpromoted, so the still-bound identity's floor is left in place.
interface LoginFloorSlot {
  identifier: string;
  ts: number | null;
}
const loginFloorSlots = new Set<LoginFloorSlot>();

/**
 * Initialize the DataGrail Consent SDK.
 * Must be called before any other method.
 */
export async function initialize(config: DataGrailConfig): Promise<void> {
  // 1. Validate config
  if (!config.configUrl || !config.configUrl.startsWith('https://')) {
    throw new ConsentError('INVALID_CONFIGURATION', 'configUrl must be a valid HTTPS URL');
  }

  // A previous instance's background refresh must not report into this session.
  configService?.dispose();

  // 2. Create StorageService
  storageService = new StorageService();

  // 3. Create NetworkService + OfflineQueue
  networkService = new NetworkService();
  offlineQueue = new OfflineQueue(storageService, networkService);

  // 4. Create ConfigService and fetch config
  configService = new ConfigService(
    networkService,
    storageService,
    config.onConfigError ? { onConfigError: config.onConfigError } : {},
  );
  // Every Universal Consent write raises the bound identity's category-stamp floor to the exact
  // decision_ts it sends, before it is sent (TRUST-3225): the write moves the record's updated_at
  // there, so a category choice made in the same second (even while the write is in flight) must be
  // stamped after it, or the next re-sync would tie and adopt the record over it. Hooked into the
  // service's one send path so no write caller can forget it or derive a different time. A write
  // sent during a login to that login's identifier is also collected for the floor the bind gives
  // the new identity (TRUST-3448), so no login-path write has to be threaded through by hand.
  universalConsentService = new UniversalConsentService(networkService, {
    onBeforeWrite: (decisionTs, identifier) => {
      storageService?.raiseUcDecisionFloor(decisionTs);
      for (const slot of loginFloorSlots) {
        if (slot.identifier === identifier) {
          slot.ts = laterTs(slot.ts, decisionTs);
        }
      }
    },
  });
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
  // An explicit choice made here, so the stored preferences are no longer a Universal Consent adopt
  // (persistPreferences stores no adopted raw choice with them).
  await persistPreferences(prefs);
}

/**
 * The ATT bridge's save: the tracking status's marketing decision (`mapATTStatusToConsent`) applied
 * to the current preferences, as the LOCAL view only. The tracking status is a device-local signal
 * (on Android it is a device setting, with no prompt), and a device signal must never change what is
 * stored cross-device (see `setUserIdentifier`). So when the stored preferences are still an adopted
 * record's view, the adopted raw choice is kept exactly as it is: a later write-through sends the
 * record's own marketing value, not the one this device's tracking status implies.
 * @internal Used by src/platform/att.*.ts.
 */
export async function saveTrackingAuthorizationPreferences(
  prefs: ConsentPreferences,
): Promise<void> {
  assertInitialized();
  await persistPreferences(prefs, storageService!.loadAdoptedRawChoice());
}

async function persistPreferences(
  prefs: ConsentPreferences,
  adoptedRaw: Record<string, boolean> | null = null,
): Promise<void> {
  // Save to storage, with the adopted raw choice these preferences are a view of (if any)
  storageService!.savePreferences(prefs, adoptedRaw);
  storageService!.saveConfigVersion(currentConfig!.version);
  storageService!.setUserConsented(true);
  // A real choice, made now (TRUST-3225): the stale-re-sync guard compares this against a found
  // record's updated_at, and every Universal Consent write sends it as decision_ts. Not when the
  // preferences are still an adopt's view (the ATT save): the raw choice a write would send is the
  // record's, unchanged, so it keeps the record's time. Stamping now would let a later re-sync
  // write that older copy over a revocation made elsewhere after the adopt.
  if (adoptedRaw === null) {
    storageService!.saveDecisionTs();
  }

  // Emit event
  eventEmitter.emit(prefs);

  // POST to backend
  const consentId = storageService!.getOrCreateUniqueId();
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    customer: currentConfig!.dgCustomerId,
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
  identityEpoch += 1;
  if (storageService) {
    // clearAll() also removes the Universal Consent identity binding (BOUND_USER_HASH lives in
    // the same MMKV instance).
    storageService.clearAll();
  }
  configService?.dispose();
  configService = null;
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
  // Leave the persisted config version untouched: logout is non-destructive (see clearUserIdentifier
  // docs). needsConsent() returns true here anyway because the user-consented flag is now cleared,
  // so re-stamping the version would only break that documented contract with no behavioural gain.
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
  identityEpoch += 1;
  if (!storageService) {
    return;
  }
  storageService.clearBoundUserHash();
  // The logged-out identity's record times must not floor the next visitor's category stamps
  // (TRUST-3225). The device-wide CCPA floor stays, by design.
  storageService.clearUcDecisionFloor();
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
 * the flag is written to their Universal Consent record as a CCPA-only write dated at the call,
 * after the current local category choice is written at its own time — but only when Universal Consent is
 * enabled, `universalConsent.syncOptout` is on, the device is bound to that identifier (a
 * `setUserIdentifier` call for it succeeded), and the user has an explicit local category choice
 * (config defaults are never written as one). Otherwise the change is local only and rides the
 * next Universal Consent write. A write failure rejects, like `setUserIdentifier`; the local flag
 * stays set.
 *
 * Resolves `true` when the flag was written to the Universal Consent record. Resolves `false` in two
 * cases, and `getCcpaOptout()` tells them apart:
 * - The call saved the flag locally only (no `sync`, the gate is off, the device isn't bound to
 *   `sync.identifier`, the binding changed while hashing, or there is no explicit category choice
 *   to write with). `getCcpaOptout()` returns `optedOut`; on a bound device it is sent by the next
 *   write-through or `setUserIdentifier` re-sync with the gate on, even if the gate was off when
 *   the choice was made (TRUST-3381).
 * - The record already held a NEWER CCPA decision (made on another device after this one), so the
 *   edge kept it. That decision wins: the SDK reads it back and it becomes the local flag, so
 *   `getCcpaOptout()` returns the record's value, not `optedOut`.
 */
export async function setCcpaOptout(
  optedOut: boolean,
  sync?: {
    identifier: string;
    apiKey?: string;
    getSignature?: SignatureProvider;
  },
): Promise<boolean> {
  assertInitialized();
  // When the host made the call, before any await, so a deferred or retried write carries it.
  // Monotonic per device (TRUST-3225): strictly after the last CCPA choice stored here and after
  // the updated_at of any record read here, so a clock running behind the record's (or a toggle
  // back within the same second) cannot lose at the edge and then be reverted by a re-sync.
  const decidedAt = storageService!.stampCcpaDecision();
  const syncs = isUniversalConsentEnabled() && currentConfig!.universalConsent?.syncOptout === true;
  const boundHash = storageService!.loadBoundUserHash();
  // Pending until a write-through below succeeds, but only on a bound device: an unbound device's
  // next setUserIdentifier is a LOGIN, which replaces the flag with the record's regardless. While
  // pending, a RE-SYNC keeps this choice instead of adopting the record's stale value (TRUST-3308).
  // Pending with the syncOptout gate off too (TRUST-3381, as web): nothing can carry it now, and the
  // first RE-SYNC after the gate turns on sends it, dated when it was made.
  storageService!.saveCcpaOptout(optedOut, boundHash !== null ? decidedAt : null);
  ccpaChoiceSeq += 1;
  // The identity this call writes for, captured before its first await and re-checked after every
  // one, so a logout or identity switch mid-chain stops it before it writes or settles anything.
  const op: UcWriteOp = { epoch: identityEpoch, boundHash };

  if (sync === undefined || !syncs) {
    return false;
  }
  // Resolved before the binding and choice checks, as every other Universal Consent call does, so a
  // missing key fails the same way whether or not this call would have written.
  const apiKey = resolveUniversalConsentApiKey(sync.apiKey);
  if (boundHash === null) {
    return false;
  }
  const userHash = await universalConsentService!.userHash(currentConfig!, sync.identifier);
  // The hash is computed natively, so a logout (and a next visitor's choice) can land while it is in
  // flight. Re-check the binding after the await: local state read below must still belong to the
  // identity bound when this call started, or the next visitor's choice would be written to it.
  if (!opIsCurrent(op) || userHash !== boundHash) {
    return false;
  }
  // No explicit category choice to write with: local only.
  if (!storageService!.hasUserConsented() || storageService!.loadPreferences() === null) {
    return false;
  }

  const result = await sendCcpaOptout({
    identifier: sync.identifier,
    apiKey,
    getSignature: sync.getSignature,
    // Re-read, not the `optedOut` argument: a later setCcpaOptout call can save (and write) a newer
    // value while this one awaits the hash, and this write must not overwrite it with the older one.
    ccpaOptout: storageService!.loadCcpaOptout(),
    decidedAt: storageService!.loadCcpaOptoutPendingSince() ?? decidedAt,
    withCategories: true,
    op,
  });
  return result === 'written';
}

/**
 * The identity a Universal Consent write chain started under: the logout epoch and the device's
 * bound user hash, captured before the chain's first await (TRUST-2591).
 */
interface UcWriteOp {
  epoch: number;
  boundHash: string | null;
}

/**
 * Whether `op`'s identity still holds: no logout or `reset()` since, and the device is bound to the
 * same identity. Checked after every await of a write chain, before it touches `currentConfig`,
 * local CCPA state or starts its next request, so an old user's flag never lands on a logged-out
 * device or the next user's.
 */
function opIsCurrent(op: UcWriteOp): boolean {
  return identityEpoch === op.epoch && storageService?.loadBoundUserHash() === op.boundHash;
}

/**
 * The one CCPA write, shared by `setCcpaOptout` and `setUserIdentifier` flushing a choice still
 * pending sync. Eligible only with an explicit local category choice (config defaults are never
 * written as one). The CCPA write itself is CCPA-only, dated when the choice was made, so the edge's
 * per-register merge orders it by its own time rather than the categories' (TRUST-3308): stamping it
 * with the category time could let a newer stored ccpa register reject it, and stamping categories
 * "now" would let a stale copy out-rank a newer revocation (TRUST-3225).
 *
 * `withCategories` writes the stored category choice first, at ITS decision time: the CCPA write
 * moves the record's updated_at forward, so an unsynced category choice would otherwise stop
 * reading as newer than the record on the next RE-SYNC and be adopted over. A RE-SYNC has already
 * written through or adopted the categories, so it skips this.
 *
 * Resolves 'written' when the choice reached the record, 'stale' when the record already held a
 * newer CCPA decision, 'not-sent' when there is no explicit category choice, the gate is off, or
 * `op`'s identity stopped holding during the chain. 'stale' is settled here, the same way for every
 * caller: the record is read back and its newer decision becomes the local flag, so
 * `getCcpaOptout()` never keeps showing a value the edge rejected. A newer setCcpaOptout call made
 * meanwhile wins. If that read fails or finds no record the choice is marked pending again, so the
 * next RE-SYNC flushes it and settles it then.
 */
async function sendCcpaOptout(send: {
  identifier: string;
  apiKey: string;
  getSignature?: SignatureProvider;
  ccpaOptout: boolean;
  decidedAt: number;
  withCategories: boolean;
  op: UcWriteOp;
}): Promise<'written' | 'stale' | 'not-sent'> {
  const localChoice = storageService!.loadPreferences();
  if (!storageService!.hasUserConsented() || localChoice === null) {
    return 'not-sent';
  }
  const categoriesDecidedAt = storageService!.loadDecisionTs();
  if (send.withCategories && categoriesDecidedAt !== null) {
    await universalConsentService!.save(
      currentConfig!,
      send.identifier,
      // The RAW choice: when local state is still an adopted record's signal-reconciled view,
      // re-sending it would store a device-local suppression (ATT, GPC) as the user's denial.
      { isCustomised: localChoice.isCustomised, cookieOptions: rawLocalChoice(localChoice) },
      send.apiKey,
      null,
      send.getSignature,
      categoriesDecidedAt,
    );
    if (!opIsCurrent(send.op)) {
      return 'not-sent';
    }
  }
  const result = await universalConsentService!.saveCcpaOptout(
    currentConfig!,
    send.identifier,
    send.apiKey,
    { ccpaOptout: send.ccpaOptout, decisionTs: send.decidedAt, getSignature: send.getSignature },
  );
  if (result === null) {
    // The syncOptout gate is off: nothing reached the record, so the choice stays pending until the
    // gate turns on (TRUST-3381).
    return 'not-sent';
  }
  if (!opIsCurrent(send.op)) {
    // Logged out (or switched identity) while the write was in flight: whatever the edge did, this
    // device's state is no longer that identity's to change.
    return 'not-sent';
  }
  storageService!.markCcpaOptoutSynced(send.ccpaOptout, send.decidedAt);
  if (!result.staleFields.includes('ccpa_optout')) {
    return 'written';
  }
  await settleStaleCcpaOptout(send);
  return 'stale';
}

/**
 * The record already held a newer CCPA decision than `send`: read it back and adopt the record's
 * flag, unless a newer setCcpaOptout choice was made meanwhile (it is pending, and wins) or `op`'s
 * identity stopped holding. Always a fresh read, never a flag read before the write: another device
 * can have changed the record between that read and this write, and the stale answer means its
 * value, not the earlier one, is the winner.
 */
async function settleStaleCcpaOptout(send: {
  identifier: string;
  apiKey: string;
  ccpaOptout: boolean;
  decidedAt: number;
  op: UcWriteOp;
}): Promise<void> {
  const seq = ccpaChoiceSeq;
  // Put the choice back to pending (when nothing newer replaced it), so the next RE-SYNC flushes it
  // and settles it with the read it makes.
  const restorePending = (): void => {
    if (
      ccpaChoiceSeq === seq &&
      !storageService!.hasPendingCcpaOptoutSync() &&
      storageService!.loadCcpaOptout() === send.ccpaOptout
    ) {
      storageService!.saveCcpaOptout(send.ccpaOptout, send.decidedAt);
    }
  };
  let record: Awaited<ReturnType<UniversalConsentService['get']>>;
  try {
    record = await universalConsentService!.get(currentConfig!, send.identifier, send.apiKey);
  } catch {
    if (opIsCurrent(send.op)) {
      restorePending();
    }
    return;
  }
  if (!opIsCurrent(send.op)) {
    return;
  }
  if (record === null) {
    // The record the edge just compared against is gone (erased since): there is no newer flag to
    // adopt, so the local choice stands, pending, like a failed read.
    restorePending();
    return;
  }
  const readRecordTs = recordDecisionTs(record.updatedAt);
  if (readRecordTs !== null) {
    storageService!.raiseCcpaDecisionFloor(readRecordTs);
    storageService!.raiseUcDecisionFloor(readRecordTs);
  }
  if (ccpaChoiceSeq === seq && !storageService!.hasPendingCcpaOptoutSync()) {
    storageService!.saveCcpaOptout(record.ccpaOptout === true);
  }
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
 * release. An empty explicit key (`process.env.UC_KEY ?? ''`) counts as absent, so config.json's
 * applies. Throws a VALIDATION_ERROR when neither is present. Call only after the enabled check, so
 * `currentConfig` is loaded.
 */
function resolveUniversalConsentApiKey(explicit?: string): string {
  const apiKey = explicit || currentConfig?.universalConsent?.apiKey;
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
  const { rawCookieOptions, adoptedPreferences, identityChanged } =
    await rehydrateReturningRawPreferences(identifier, resolvedApiKey, trackingSignal, false);
  if (adoptedPreferences !== null) {
    eventEmitter.emit(adoptedPreferences);
  }
  return !identityChanged && rawCookieOptions !== null;
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
 * `adoptedPreferences` is the local state the adopt stored (`null` when nothing was applied). The
 * read does NOT tell the consent-changed listener: `setUserIdentifier` may still put a newer local
 * choice back over it, and telling listeners about the older record first would let a host start
 * an SDK the user just turned off. Each caller emits once, with the state it settles on.
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
  recordDecisionTs: number | null;
  suppressNonEssential: boolean;
  adoptedPreferences: ConsentPreferences | null;
  identityChanged: boolean;
  ccpaSetDuringRead: boolean;
}> {
  // Both callers have already checked that Universal Consent is enabled.
  const epochAtStart = identityEpoch;
  const ccpaSeqAtStart = ccpaChoiceSeq;
  // Goes to the service directly rather than through fetchUniversalConsent, which returns an
  // already-reconciled record. Both views are needed here: the reconciled one to persist locally,
  // the raw one to hand back for the write.
  const record = await universalConsentService!.get(currentConfig!, identifier, apiKey);
  // A logout (or reset) while the read was in flight: the record is the logged-out user's, and the
  // device is neutral now. Apply nothing.
  if (identityEpoch !== epochAtStart) {
    return {
      recordFound: false,
      rawCookieOptions: null,
      recordCcpaOptout: null,
      recordDecisionTs: null,
      suppressNonEssential: false,
      adoptedPreferences: null,
      identityChanged: true,
      ccpaSetDuringRead: false,
    };
  }
  // A setCcpaOptout made while the read was in flight is newer than the record: keep it.
  const ccpaSetDuringRead = ccpaChoiceSeq !== ccpaSeqAtStart;
  // A CCPA choice made from now on must order after every register this record holds (TRUST-3225),
  // whatever is adopted from it below.
  const readRecordTs = recordDecisionTs(record?.updatedAt);
  if (readRecordTs !== null) {
    storageService!.raiseCcpaDecisionFloor(readRecordTs);
  }

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
      recordDecisionTs: readRecordTs,
      suppressNonEssential: false,
      adoptedPreferences: null,
      identityChanged: false,
      ccpaSetDuringRead,
    };
  }
  // Boolean entries only: a malformed value from another writer is neither applied nor re-sent.
  const rawCookieOptions = booleanEntries(record.consentPreferences.cookieOptions ?? {});

  // Local state gets the RECONCILED view — either signal suppresses. The stored `gpc` came from
  // the web, the tracking signal from this device; neither can re-enable what the other suppressed.
  const suppressNonEssential = record!.gpc || signalSuppressesNonEssential(trackingSignal);
  // A record that came back at all represents an answered prompt, so the rehydrated state is
  // customised even if the writer left the flag false.
  const preferences = persistReconciledChoice(
    true,
    rawCookieOptions,
    suppressNonEssential,
    fillFromNeutral,
  );
  // Stamp the CURRENT config version, not the record's. needsConsent() compares the stored
  // version against the running config, so carrying a stale version over from the writing
  // device would re-prompt immediately and undo the rehydration we just did.
  storageService!.saveConfigVersion(currentConfig!.version);
  // needsConsent() gates on this flag rather than on preferences merely existing (initialize()
  // auto-persists defaults). Without it the rehydrated state would apply to category reads but
  // the banner would still show, which is the bug this method exists to fix.
  storageService!.setUserConsented(true);
  // The adopted choice was made when the RECORD says, not now (TRUST-3225): stamping now would make
  // this copy look newer than it is, and a later re-sync from this device could then out-rank a
  // revocation made elsewhere in between. An unknown record time leaves the local time unknown too.
  const adoptedDecisionTs = recordDecisionTs(record!.updatedAt);
  if (adoptedDecisionTs !== null) {
    storageService!.saveDecisionTs(adoptedDecisionTs);
  } else {
    storageService!.clearDecisionTs();
  }
  // The record's stored CCPA opt-out replaces the local flag along with the categories (an absent
  // field decodes to false). Not derived from anything: it is the user's recorded DNSMPI choice.
  // Outside a login, adopt it only with the syncOptout gate on: with the gate off the SDK never
  // puts the choice on the record (writes leave the field out), so adopting it would erase a local-only
  // setCcpaOptout(true) on every re-sync. Same rule as the web/iOS/Android SDKs. Nor, on a re-sync,
  // while a setCcpaOptout choice is pending sync (TRUST-3308): it has not reached the record, so the
  // record still holds the value the user just changed, and adopting it would discard that choice.
  // A login adopt replaces the flag regardless (and so clears the pending marker). Never over a
  // setCcpaOptout made during the read, which is newer than the record.
  if (
    !ccpaSetDuringRead &&
    (fillFromNeutral ||
      (currentConfig!.universalConsent?.syncOptout === true &&
        !storageService!.hasPendingCcpaOptoutSync()))
  ) {
    storageService!.saveCcpaOptout(record!.ccpaOptout);
  }

  return {
    recordFound: true,
    rawCookieOptions,
    recordCcpaOptout: record!.ccpaOptout,
    recordDecisionTs: adoptedDecisionTs,
    suppressNonEssential,
    adoptedPreferences: preferences,
    identityChanged: false,
    ccpaSetDuringRead,
  };
}

/**
 * The outcome of a `setUserIdentifier` call once the read has completed, as a tagged action so the
 * identity binding can be applied in exactly one place (TRUST-3075). The read has already adopted
 * any found record into local state; this only describes what, if anything, is written and which
 * local flags are touched before binding.
 *
 * - `bindOnly` — no cross-device write. Optionally return local state to neutral (a found record's
 *   existence overrides a pre-login or other-user choice) and/or overwrite the local CCPA flag from
 *   the record (`adoptCcpaFromRecord`: a boolean overwrites it, `null` leaves it untouched).
 * - `write` — write the current local choice through, then bind. The CCPA side of that write is
 *   decided here too (TRUST-3391): `carryCcpa` sends the local flag on the category write (a miss
 *   creating the record with nothing pending); `restoreLocalCcpa` puts the captured local flag (and
 *   its pending marker) back over whatever the read stored; `adoptCcpaFromRecord` adopts a found
 *   signal-only record's flag on a re-sync, which the read returned before doing; `flushPendingCcpa`
 *   sends a pending choice as its own CCPA-only write after the category write.
 * - `flushCcpa` — a RE-SYNC adopted the record's categories, but a setCcpaOptout choice is still
 *   pending sync: send it as a CCPA-only write dated when it was made, then bind (TRUST-3308).
 */
type IdentityBindDecision =
  | { kind: 'bindOnly'; returnToNeutral: boolean; adoptCcpaFromRecord: boolean | null }
  | {
      kind: 'write';
      carryCcpa: boolean;
      restoreLocalCcpa: boolean;
      adoptCcpaFromRecord: boolean | null;
      flushPendingCcpa: boolean;
    }
  | { kind: 'flushCcpa' };

/** The inputs the `setUserIdentifier` decision reads: the read result and the captured local state. */
interface IdentityBindInput {
  /** A record (of any shape, including signal-only) came back from the read. */
  recordFound: boolean;
  /** The record carried an answered consent choice the read adopted (`rawCookieOptions !== null`). */
  hasUsablePrefs: boolean;
  /** The device was already bound to this identity, so any local change was made after login. */
  isResync: boolean;
  /** The device was bound to a DIFFERENT identity (its local state belongs to that user). */
  boundToOther: boolean;
  /** `hasUserConsented()` at entry — the banner/`savePreferences` flag, before the read overwrote it. */
  hadConsentedFlag: boolean;
  /** An explicit local category choice exists for THIS identity (not defaults, not another user's). */
  hasExplicitChoice: boolean;
  /**
   * The local choice was made strictly AFTER the found record's latest decision (TRUST-3225): both
   * times are known and local > record `updated_at`. `false` when either is unknown or they tie.
   */
  localIsNewerThanRecord: boolean;
  /** The record's stored CCPA opt-out (`null` when absent). */
  recordCcpaOptout: boolean | null;
  /** `universalConsent.syncOptout` — whether the CCPA flag is carried on the wire for this config. */
  syncOptout: boolean;
  /** A setCcpaOptout choice has not reached the record yet, so a RE-SYNC must keep it (TRUST-3308). */
  ccpaPendingSync: boolean;
  /** A setCcpaOptout call landed while the read was in flight: it is newer than the record. */
  ccpaSetDuringRead: boolean;
}

/**
 * Decide what `setUserIdentifier` does after the read, as a pure function of the read result and the
 * captured local state (the TRUST-2902 rule; see `setUserIdentifier`'s JSDoc for the full table).
 * Side-effect-free: every branch returns a tagged action and the caller performs the side effects,
 * so the "bind on every success path, never on a failure path" invariant is enforced in one place
 * (bind once, after the executor) rather than positionally at each exit (TRUST-3075).
 */
export function decideIdentityBind(input: IdentityBindInput): IdentityBindDecision {
  const {
    recordFound,
    hasUsablePrefs,
    isResync,
    boundToOther,
    hadConsentedFlag,
    hasExplicitChoice,
    localIsNewerThanRecord,
    recordCcpaOptout,
    syncOptout,
    ccpaPendingSync,
    ccpaSetDuringRead,
  } = input;

  // The one rule for a RE-SYNC of a found record adopting the record's CCPA flag, on a write or
  // not: only under the syncOptout gate, and never over a setCcpaOptout choice still pending sync
  // (TRUST-3308) or one made during the read. `null` leaves the local flag as it is.
  const recordCcpaToAdopt =
    recordFound && isResync && syncOptout && !ccpaPendingSync && !ccpaSetDuringRead
      ? recordCcpaOptout === true
      : null;

  // A write-through. A genuine miss creates the record, so the local CCPA flag rides the write. A
  // RE-SYNC write over a FOUND record carries a category change, not a CCPA decision: the flag was
  // not decided at the categories' time, so sending it would let this device revoke a newer opt-out
  // made on another device. A re-sync's pending choice is never carried by the category write
  // either (that write is dated at the categories' time, which can be older than the CCPA choice):
  // it is flushed by its own CCPA-only write afterwards. Locally, the captured flag is put back
  // unless this is a found re-sync with nothing pending, where the record's flag stands: the read
  // adopted it from a record with usable prefs, and a signal-only record's is adopted here.
  const write = (): IdentityBindDecision => {
    const foundResync = isResync && recordFound;
    const flushPendingCcpa = isResync && ccpaPendingSync;
    const restoreLocalCcpa = !foundResync || ccpaPendingSync;
    return {
      kind: 'write',
      carryCcpa: !foundResync && !flushPendingCcpa,
      restoreLocalCcpa,
      adoptCcpaFromRecord: !restoreLocalCcpa && !hasUsablePrefs ? recordCcpaToAdopt : null,
      flushPendingCcpa,
    };
  };

  // LOGIN + FOUND signal-only record (consent_preferences ABSENT — TRUST-2961: a present but empty
  // map is an answered essential-only choice, adopted by the read as usable prefs, not here). There
  // is nothing to adopt, but the record's existence means the device's own state must not be
  // attached: drop it to neutral if anything explicit or another user's state is stored (a no-op
  // when local is already neutral). The record is authoritative for the stored CCPA flag. No write.
  if (!hasUsablePrefs && recordFound && !isResync) {
    return {
      kind: 'bindOnly',
      returnToNeutral: hadConsentedFlag || boundToOther,
      adoptCcpaFromRecord: recordCcpaOptout === true,
    };
  }

  // FOUND usable prefs: the read already adopted the record into local state. A LOGIN lets the
  // record win over any pre-login choice; a RE-SYNC with no local change has nothing to re-POST.
  // Either binds without writing. A RE-SYNC with an explicit local change writes it through, but
  // only when that change is NEWER than the record (TRUST-3225, P0-06). Otherwise this device holds
  // a stale copy (the user changed their choice on another device since this one last synced), and
  // writing it would undo the newer choice, so the adopt stands. The record's updated_at is the
  // latest decision across ALL its categories, so this errs toward adopting: a newer local change
  // to one category can lose to an even newer change elsewhere (per-category times on GET are
  // TRUST-3226). An unknown local time, an unusable updated_at, and a same-second tie all adopt.
  // A RE-SYNC that adopts can still owe the record a write: a setCcpaOptout choice that has not
  // reached it yet (no `sync`, or a failed write-through) is a local change too. It is flushed as a
  // CCPA-only write, so the categories another device chose stay as they are. Only with an
  // explicit local choice (config defaults are never written) and the syncOptout gate on.
  if (hasUsablePrefs) {
    if (isResync && hasExplicitChoice && localIsNewerThanRecord) {
      return write();
    }
    if (isResync && hasExplicitChoice && syncOptout && ccpaPendingSync) {
      return { kind: 'flushCcpa' };
    }
    return { kind: 'bindOnly', returnToNeutral: false, adoptCcpaFromRecord: null };
  }

  // No usable prefs (a miss, or a found signal-only record on a RE-SYNC) and nothing explicit to
  // attach: write nothing — config defaults are never seeded as a choice. A device still bound to
  // someone else returns to neutral so their state does not linger for this user. A RE-SYNC of a
  // found signal-only record adopts its CCPA flag under the syncOptout gate, unless a setCcpaOptout
  // choice is still pending sync (TRUST-3308).
  if (!hasExplicitChoice) {
    return {
      kind: 'bindOnly',
      returnToNeutral: boundToOther,
      adoptCcpaFromRecord: recordCcpaToAdopt,
    };
  }

  // A miss (or a found signal-only record on a RE-SYNC) WITH an explicit local choice: write it
  // through — sync-on-change over a found record, or this identity's first record on a miss.
  return write();
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
 *   choice through (sync-on-change), but only when that change was made AFTER the record's latest
 *   decision (TRUST-3225). A local copy that is not newer — a stale device returning after the user
 *   changed their choice elsewhere — adopts the record, so it can never undo a newer revocation.
 *   The write NEVER re-POSTs the fetched record, and carries the local choice's true decision time.
 * - RE-SYNC + MISS: an explicit local choice is written; otherwise nothing is.
 *
 * The CCPA opt-out flag (`setCcpaOptout`) follows the same rule: a found record's `ccpa_optout`
 * replaces the local flag (a pre-login value is dropped). A write that creates the record carries the
 * raw local flag; a re-sync never carries it on the category write, and a `setCcpaOptout` choice
 * still pending sync gets its own CCPA-only write, dated when it was made. A `setCcpaOptout` call on its own is not an explicit category choice, so it never makes a
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
  // Captured before the first await: a logout (clearUserIdentifier, reset) from here on means this
  // call applies nothing and does not bind, whether it lands during the hash, the read or the write.
  const epochAtEntry = identityEpoch;

  const apiKey = resolveUniversalConsentApiKey(options.apiKey);
  const { getSignature } = options;
  const trackingSignal = options.trackingSignal ?? readTrackingSignal();

  // Hash first: a VALIDATION_ERROR / NATIVE_ERROR fails fast here with no read, no write and no
  // change to the binding.
  const userHash = await universalConsentService!.userHash(currentConfig!, identifier);
  // Logged out while hashing: the device is neutral now, so no read, no write and no bind.
  if (identityEpoch !== epochAtEntry) {
    return;
  }
  const boundHash = storageService!.loadBoundUserHash();
  const isResync = boundHash === userHash;
  const call: IdentityCall = {
    identifier,
    apiKey,
    getSignature,
    trackingSignal,
    epochAtEntry,
    userHash,
    isResync,
    boundToOther: boundHash !== null && !isResync,
  };
  if (isResync) {
    await syncIdentity(call, null);
    return;
  }
  // A login: every write it sends to this identifier lands in its own slot, promoted at the bind.
  // Dropped however the login ends, so a failed one never reaches the floor (TRUST-3448).
  const loginFloor: LoginFloorSlot = { identifier, ts: null };
  loginFloorSlots.add(loginFloor);
  try {
    await syncIdentity(call, loginFloor);
  } finally {
    loginFloorSlots.delete(loginFloor);
  }
}

/** What {@link setUserIdentifier} resolved before the read: the call's inputs and the binding. */
interface IdentityCall {
  identifier: string;
  apiKey: string;
  getSignature: SignatureProvider | undefined;
  trackingSignal: ATTStatus;
  epochAtEntry: number;
  userHash: string;
  isResync: boolean;
  boundToOther: boolean;
}

/**
 * The read, decision, write and bind of {@link setUserIdentifier}. `loginFloor` is the login's
 * pending floor slot (`null` on a re-sync), filled by the onBeforeWrite hook.
 */
async function syncIdentity(
  {
    identifier,
    apiKey,
    getSignature,
    trackingSignal,
    epochAtEntry,
    userHash,
    isResync,
    boundToOther,
  }: IdentityCall,
  loginFloor: LoginFloorSlot | null,
): Promise<void> {
  // Capture the user's RAW local choice BEFORE the rehydrate below overwrites storage with the
  // signal-reconciled view. Only an EXPLICIT choice may be written: initialize() auto-persists
  // config defaults, and hasUserConsented() is the flag that tells the two apart. State left by a
  // different bound identity is that user's, never an explicit choice for this one.
  const localChoice = storageService!.loadPreferences();
  const hadConsentedFlag = storageService!.hasUserConsented();
  const hasExplicitChoice = hadConsentedFlag && localChoice !== null && !boundToOther;
  // When the local choice is itself an earlier adopt, storage holds its signal-reconciled view: the
  // raw map it came from is what a write must carry. Captured here because the read replaces it.
  const localRawChoice = hasExplicitChoice ? rawLocalChoice(localChoice!) : null;
  // The raw local CCPA opt-out, captured for the same reason: rehydrating a found record replaces it.
  let localCcpaOptout = storageService!.loadCcpaOptout();
  let localCcpaPendingSince = storageService!.loadCcpaOptoutPendingSince();
  // ...and when the local choice was made (TRUST-3225): adopting a found record overwrites it with
  // the record's time. Only meaningful for an explicit choice; `null` = unknown.
  const localDecisionTs = hasExplicitChoice ? storageService!.loadDecisionTs() : null;

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
    recordDecisionTs: remoteDecisionTs,
    suppressNonEssential,
    adoptedPreferences,
    identityChanged,
    ccpaSetDuringRead,
  } = await rehydrateReturningRawPreferences(
    identifier,
    apiKey,
    trackingSignal,
    // A login REPLACES local state with the record; a re-sync keeps today's adopt behavior.
    !isResync,
  );

  // The host logged out while the read was in flight. The read applied nothing; this call writes
  // nothing and does not bind, so the next visitor gets the neutral device logout left.
  if (identityChanged) {
    return;
  }
  // A category choice made from here on must be stamped after the record just read (TRUST-3225).
  // Only raised, on a LOGIN too: the device stays bound to the previous identity until the bind
  // below succeeds, and a login that fails before it must not leave that identity with this one's
  // lower floor. The bind replaces it with this identity's times alone.
  if (remoteDecisionTs !== null) {
    storageService!.raiseUcDecisionFloor(remoteDecisionTs);
  }
  // A setCcpaOptout call made while the read was in flight is newer than both the value captured
  // above and the record: the read kept it, and it is the user's flag from here on, on a login as
  // on a re-sync. On a re-sync its pending-sync marker is whatever the call left; a login starts
  // the new identity with none (the choice was made before this identity was bound). The branches
  // below keep it locally, and a write carries it.
  if (ccpaSetDuringRead) {
    localCcpaOptout = storageService!.loadCcpaOptout();
    localCcpaPendingSince = isResync ? storageService!.loadCcpaOptoutPendingSince() : null;
  }
  const localCcpaPendingSync = localCcpaPendingSince !== null;

  // The read is done and any found record is already applied to local state. The rest is a pure
  // decision over the read result and the captured local state (see `decideIdentityBind`): a
  // bind-only no-op/adopt, or a write-through. Keeping the decision pure lets the identity binding
  // run in ONE place below — on every success shape, never on a read or write failure (both throw
  // before it) and never more than once — rather than being hand-placed at each exit.
  const decision = decideIdentityBind({
    recordFound,
    hasUsablePrefs: rawFromRecord !== null,
    isResync,
    boundToOther,
    hadConsentedFlag,
    hasExplicitChoice,
    localIsNewerThanRecord:
      localDecisionTs !== null && remoteDecisionTs !== null && localDecisionTs > remoteDecisionTs,
    recordCcpaOptout,
    syncOptout: currentConfig!.universalConsent?.syncOptout === true,
    ccpaPendingSync: localCcpaPendingSync,
    ccpaSetDuringRead,
  });
  // The one CCPA-only flush of a pending choice, dated when it was made. Both decisions that flush
  // are RE-SYNCs with a pending choice, so the device is bound to `userHash` and the time is known.
  const flushPendingCcpaOptout = () =>
    sendCcpaOptout({
      identifier,
      apiKey,
      getSignature,
      ccpaOptout: localCcpaOptout,
      decidedAt: localCcpaPendingSince!,
      withCategories: false,
      op: { epoch: epochAtEntry, boundHash: userHash },
    });

  if (decision.kind === 'write') {
    // Write the user's CURRENT LOCAL choice: a re-sync's sync-on-change over a found record, or an
    // explicit choice attached to a missing record. NEVER `rawFromRecord`, which would discard the
    // choice made on this device. The choice was captured BEFORE rehydrate, so it is RAW and no
    // device signal leaks into the store.
    const universalPrefs: UniversalConsentPreferences = {
      isCustomised: localChoice!.isCustomised,
      cookieOptions: localRawChoice!,
    };

    // What the write does with the CCPA flag is part of the decision (see decideIdentityBind).
    const ccpaOnWrite = decision.carryCcpa ? localCcpaOptout : null;
    if (decision.restoreLocalCcpa) {
      storageService!.saveCcpaOptout(localCcpaOptout, localCcpaPendingSince);
    } else if (decision.adoptCcpaFromRecord !== null) {
      storageService!.saveCcpaOptout(decision.adoptCcpaFromRecord);
    }
    // Same for the decision time: the write carries the local choice, so local keeps its time.
    if (localDecisionTs !== null) {
      storageService!.saveDecisionTs(localDecisionTs);
    } else {
      storageService!.clearDecisionTs();
    }
    // ...and the categories (TRUST-3310). The read stored the found record locally before the
    // decision, but a re-sync only writes through when the local choice is NEWER than that record,
    // so local reads must show the choice being written, not the older record (which could re-enable
    // a category the user just turned off here). Same outcome as web and iOS. The read did not emit
    // the older record, so this is the only state listeners hear about.
    if (rawFromRecord !== null) {
      // isCustomised is the local choice's own (acceptAll/rejectAll store false), matching the write.
      eventEmitter.emit(
        persistReconciledChoice(
          localChoice!.isCustomised,
          localRawChoice!,
          suppressNonEssential,
          false,
        ),
      );
    }

    // Dated at the TRUE time of the local choice (TRUST-3225); the service dates an unknown one (a
    // choice stored before decision times were recorded) at the request time, as the edge would.
    await universalConsentService!.save(
      currentConfig!,
      identifier,
      universalPrefs,
      apiKey,
      // The RAW local flag, set only by setCcpaOptout or a record adopt — never derived from the
      // tracking signal, ATT or marketing consent (TRUST-2591). The service applies the syncOptout
      // gate. `null` on a found re-sync (the record's flag is left as it is, see above) and for a
      // pending choice, which is flushed on its own below.
      ccpaOnWrite,
      getSignature,
      localDecisionTs,
    );
    // Logged out (or reset) while the write was in flight: nothing more is sent or changed, and the
    // device stays unbound. Checked before `currentConfig`, which reset() nulls.
    if (identityEpoch !== epochAtEntry) {
      return;
    }
    if (currentConfig!.universalConsent?.syncOptout === true) {
      if (ccpaOnWrite !== null) {
        // The flag reached the record (the service only carries it under the syncOptout gate).
        storageService!.markCcpaOptoutSynced(localCcpaOptout, localCcpaPendingSince);
      } else if (decision.flushPendingCcpa) {
        await flushPendingCcpaOptout();
      }
    }
  } else if (decision.kind === 'flushCcpa') {
    // The adopted record is what local state settles on; tell listeners once, before the flush.
    eventEmitter.emit(adoptedPreferences!);
    // The read adopted the record's categories and (pending) kept the local CCPA flag: send that
    // choice as its own CCPA-only write, dated when it was made, so no category is re-stamped.
    await flushPendingCcpaOptout();
  } else {
    // No write. A found record's existence can override a pre-login or other-user local choice
    // (returnToNeutral), and/or the record is authoritative for the stored CCPA flag
    // (adoptCcpaFromRecord). Apply them in that order — matching what the hand-placed success
    // branches did — leaving a plain adopt (both false/null) as bind-only. An adopt the read stored
    // is what local state settles on, so listeners hear about it here, once.
    if (adoptedPreferences !== null) {
      eventEmitter.emit(adoptedPreferences);
    }
    if (decision.returnToNeutral) {
      returnToNeutral();
    }
    if (ccpaSetDuringRead) {
      storageService!.saveCcpaOptout(localCcpaOptout, localCcpaPendingSince);
    } else if (decision.adoptCcpaFromRecord !== null) {
      storageService!.saveCcpaOptout(decision.adoptCcpaFromRecord);
    }
  }

  // Bind exactly once, on every success path. A read failure (the rehydrate above) or a write
  // failure (the awaited save) propagates before this line, so a failed call never binds and a
  // retry is still recognised as a login and re-evaluated from scratch. A logout while the write was
  // in flight wins too: the device stays unbound.
  if (identityEpoch !== epochAtEntry) {
    return;
  }
  storageService!.saveBoundUserHash(userHash);
  if (loginFloor !== null) {
    // Bound to the new identity: from here its own record times alone floor the next stamps
    // (TRUST-3225), never the previous identity's (a previous record read off a clock running
    // ahead would otherwise push this identity's category and CCPA stamps ahead of real time).
    // Those times are the record read and every write this login sent it (TRUST-3448).
    storageService!.resetUcDecisionFloor(laterTs(remoteDecisionTs, loginFloor.ts));
    storageService!.rebaseCcpaDecisionFloor(remoteDecisionTs);
  }
}

/** The later of two optional unix-second times, or `null` when both are unknown. */
function laterTs(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.max(a, b);
}

/**
 * Store a RAW answered category choice as local state, the one rule for "what a stored raw choice
 * becomes locally" — used by the read's adopt and by a re-sync write-through that puts the newer
 * local choice back over the older record the read stored (TRUST-3310). Returns the stored
 * preferences; the caller emits them.
 *
 * - Local state is the signal-RECONCILED view: `suppressNonEssential` (the record's GPC or this
 *   device's tracking signal) turns non-essential categories off. Neither signal can re-enable what
 *   the other suppressed.
 * - `fillFromNeutral` (a login) starts from the config defaults, never the prior local value, and
 *   overlays the choice. An EMPTY answered map is an essential-only choice (TRUST-2961): no optional
 *   category takes its config default, or a login would enable categories a re-sync leaves off.
 * - Essential categories are always on, even when the map omits them or carries `false`.
 * - `isCustomised` is the caller's: the read forces it true for an adopted record, while a restore
 *   keeps the local choice's own flag, so local state matches what the write carries.
 * - `rawChoice` is kept as the adopted raw choice, so a later write-through re-sends what the user
 *   chose, not the suppressed view.
 */
function persistReconciledChoice(
  isCustomised: boolean,
  rawChoice: Record<string, boolean>,
  suppressNonEssential: boolean,
  fillFromNeutral: boolean,
): ConsentPreferences {
  const essentialKeys = new Set(ConsentResolver.getEssentialCategories(currentConfig!));
  const reconciled = reconcileSignals(rawChoice, suppressNonEssential, essentialKeys);
  // A fresh map: when no signal applies `reconciled` IS `rawChoice`, which must not be mutated.
  const cookieOptions: Record<string, boolean> = {};
  // A map that names no optional category this config knows is an essential-only choice
  // (TRUST-2961): empty, essentials only (another SDK's reject-all), or only unknown keys. No
  // optional category takes its config default then, or a login would enable categories a re-sync
  // of the same record leaves off.
  if (fillFromNeutral) {
    const defaults = ConsentResolver.getDefaults(currentConfig!).cookieOptions;
    const essentialOnly = !defaults.some(
      (option) => !essentialKeys.has(option.gtmKey) && option.gtmKey in rawChoice,
    );
    for (const option of defaults) {
      cookieOptions[option.gtmKey] = essentialOnly ? false : option.isEnabled;
    }
  }
  Object.assign(cookieOptions, reconciled);
  for (const key of essentialKeys) {
    cookieOptions[key] = true;
  }
  const preferences: ConsentPreferences = {
    isCustomised,
    cookieOptions: Object.entries(cookieOptions).map(([gtmKey, isEnabled]) => ({
      gtmKey,
      isEnabled,
    })),
  };
  // Stored with the raw choice it is a view of, so a later write-through re-sends what was chosen.
  storageService!.savePreferences(preferences, rawChoice);
  return preferences;
}

/**
 * The RAW category map a write-through sends for the stored local choice: the adopted record's raw
 * map while the stored preferences are still that adopt's signal-reconciled view, else the stored
 * preferences themselves (an explicit choice made on this device is already raw).
 */
function rawLocalChoice(localChoice: ConsentPreferences): Record<string, boolean> {
  return storageService!.loadAdoptedRawChoice() ?? toRawCookieMap(localChoice);
}

/** The `{ gtmKey: isEnabled }` map a Universal Consent write carries, from local preferences. */
function toRawCookieMap(prefs: ConsentPreferences): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const option of prefs.cookieOptions) {
    map[option.gtmKey] = option.isEnabled;
  }
  return map;
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
    customer: currentConfig!.dgCustomerId,
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
