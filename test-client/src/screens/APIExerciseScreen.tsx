import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {
  initialize,
  reset,
  needsConsent,
  hasUserConsent,
  isCategoryEnabled,
  getPreferences,
  getCategories,
  getConfig,
  acceptAll,
  rejectAll,
  savePreferences,
  retryPendingRequests,
  requestTrackingAuthorization,
  getTrackingStatus,
  getConsentPayloadForWebView,
  getConsentInjectionScript,
  trackBannerShown,
} from '@datagrail/react-native-consent';
import type { ConsentPreferences } from '@datagrail/react-native-consent';
import { ResultDisplay } from '../components/ResultDisplay';
import type { ResultValue } from '../components/ResultDisplay';
import { DEFAULT_CONFIG_URL, DEFAULT_PREFERENCES_JSON } from '../utils/mockConfig';

type ResultMap = Record<string, ResultValue | null>;

export function APIExerciseScreen(): React.JSX.Element {
  const [configUrl, setConfigUrl] = useState(DEFAULT_CONFIG_URL);
  const [categoryInput, setCategoryInput] = useState('analytics');
  const [preferencesInput, setPreferencesInput] = useState(DEFAULT_PREFERENCES_JSON);
  const [results, setResults] = useState<ResultMap>({});

  const setResult = useCallback((key: string, value: ResultValue) => {
    setResults((prev) => ({ ...prev, [key]: value }));
  }, []);

  const callAsync = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      try {
        const value = await fn();
        setResult(key, { type: 'success', value: value ?? 'void (success)' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setResult(key, { type: 'error', error: message });
      }
    },
    [setResult],
  );

  const callSync = useCallback(
    (key: string, fn: () => unknown) => {
      try {
        const value = fn();
        setResult(key, { type: 'success', value: value ?? 'void (success)' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setResult(key, { type: 'error', error: message });
      }
    },
    [setResult],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Initialization */}
      <Text style={styles.sectionTitle}>Initialization</Text>
      <View style={styles.section}>
        <Text style={styles.inputLabel}>Config URL:</Text>
        <TextInput
          style={styles.input}
          value={configUrl}
          onChangeText={setConfigUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://..."
        />
        <APIButton
          label="initialize()"
          onPress={() => callAsync('initialize', () => initialize({ configUrl }))}
        />
        <ResultDisplay label="initialize" result={results['initialize'] ?? null} />

        <APIButton
          label="reset()"
          onPress={() => callSync('reset', () => reset())}
        />
        <ResultDisplay label="reset" result={results['reset'] ?? null} />
      </View>

      {/* Consent State */}
      <Text style={styles.sectionTitle}>Consent State</Text>
      <View style={styles.section}>
        <APIButton
          label="needsConsent()"
          onPress={() => callSync('needsConsent', () => needsConsent())}
        />
        <ResultDisplay label="needsConsent" result={results['needsConsent'] ?? null} />

        <APIButton
          label="hasUserConsent()"
          onPress={() => callSync('hasUserConsent', () => hasUserConsent())}
        />
        <ResultDisplay label="hasUserConsent" result={results['hasUserConsent'] ?? null} />

        <Text style={styles.inputLabel}>Category:</Text>
        <TextInput
          style={styles.input}
          value={categoryInput}
          onChangeText={setCategoryInput}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. analytics"
        />
        <APIButton
          label="isCategoryEnabled()"
          onPress={() =>
            callSync('isCategoryEnabled', () => isCategoryEnabled(categoryInput))
          }
        />
        <ResultDisplay label="isCategoryEnabled" result={results['isCategoryEnabled'] ?? null} />

        <APIButton
          label="getPreferences()"
          onPress={() => callSync('getPreferences', () => getPreferences())}
        />
        <ResultDisplay label="getPreferences" result={results['getPreferences'] ?? null} />

        <APIButton
          label="getCategories()"
          onPress={() => callSync('getCategories', () => getCategories())}
        />
        <ResultDisplay label="getCategories" result={results['getCategories'] ?? null} />

        <APIButton
          label="getConfig()"
          onPress={() => callSync('getConfig', () => getConfig())}
        />
        <ResultDisplay label="getConfig" result={results['getConfig'] ?? null} />
      </View>

      {/* Consent Actions */}
      <Text style={styles.sectionTitle}>Consent Actions</Text>
      <View style={styles.section}>
        <APIButton
          label="acceptAll()"
          onPress={() => callAsync('acceptAll', () => acceptAll())}
        />
        <ResultDisplay label="acceptAll" result={results['acceptAll'] ?? null} />

        <APIButton
          label="rejectAll()"
          onPress={() => callAsync('rejectAll', () => rejectAll())}
        />
        <ResultDisplay label="rejectAll" result={results['rejectAll'] ?? null} />

        <Text style={styles.inputLabel}>Preferences JSON:</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={preferencesInput}
          onChangeText={setPreferencesInput}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <APIButton
          label="savePreferences()"
          onPress={() =>
            callAsync('savePreferences', () => {
              const prefs: ConsentPreferences = JSON.parse(preferencesInput);
              return savePreferences(prefs);
            })
          }
        />
        <ResultDisplay label="savePreferences" result={results['savePreferences'] ?? null} />

        <APIButton
          label="retryPendingRequests()"
          onPress={() =>
            callAsync('retryPendingRequests', () => retryPendingRequests())
          }
        />
        <ResultDisplay
          label="retryPendingRequests"
          result={results['retryPendingRequests'] ?? null}
        />
      </View>

      {/* Tracking */}
      <Text style={styles.sectionTitle}>Tracking</Text>
      <View style={styles.section}>
        <APIButton
          label="requestTrackingAuthorization()"
          onPress={() =>
            callAsync('requestTrackingAuthorization', () =>
              requestTrackingAuthorization(),
            )
          }
        />
        <ResultDisplay
          label="requestTrackingAuthorization"
          result={results['requestTrackingAuthorization'] ?? null}
        />

        <APIButton
          label="getTrackingStatus()"
          onPress={() => callSync('getTrackingStatus', () => getTrackingStatus())}
        />
        <ResultDisplay label="getTrackingStatus" result={results['getTrackingStatus'] ?? null} />
      </View>

      {/* WebView */}
      <Text style={styles.sectionTitle}>WebView</Text>
      <View style={styles.section}>
        <APIButton
          label="getConsentPayloadForWebView()"
          onPress={() =>
            callSync('getConsentPayloadForWebView', () =>
              getConsentPayloadForWebView(),
            )
          }
        />
        <ResultDisplay
          label="getConsentPayloadForWebView"
          result={results['getConsentPayloadForWebView'] ?? null}
        />

        <APIButton
          label="getConsentInjectionScript()"
          onPress={() =>
            callSync('getConsentInjectionScript', () => getConsentInjectionScript())
          }
        />
        <ResultDisplay
          label="getConsentInjectionScript"
          result={results['getConsentInjectionScript'] ?? null}
        />
      </View>

      {/* Events */}
      <Text style={styles.sectionTitle}>Events</Text>
      <View style={styles.section}>
        <APIButton
          label="trackBannerShown()"
          onPress={() => callAsync('trackBannerShown', () => trackBannerShown())}
        />
        <ResultDisplay label="trackBannerShown" result={results['trackBannerShown'] ?? null} />
      </View>

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

interface APIButtonProps {
  label: string;
  onPress: () => void;
}

function APIButton({ label, onPress }: APIButtonProps): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginTop: 20,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  section: {
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    fontSize: 13,
    fontFamily: 'Menlo',
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  multilineInput: {
    height: 120,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#2196f3',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 4,
    marginTop: 6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Menlo',
  },
  bottomPad: {
    height: 40,
  },
});
