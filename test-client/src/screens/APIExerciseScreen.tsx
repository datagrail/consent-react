import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
  const scrollRef = useRef<ScrollView>(null);
  const [configUrl, setConfigUrl] = useState(DEFAULT_CONFIG_URL);
  const [categoryInput, setCategoryInput] = useState('dg-category-marketing');
  const [preferencesInput, setPreferencesInput] = useState(DEFAULT_PREFERENCES_JSON);
  const [results, setResults] = useState<ResultMap>({});
  const [scrollVersion, setScrollVersion] = useState(0);

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

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  useFocusEffect(
    useCallback(() => {
      setScrollVersion((version) => version + 1);
      scrollToTop();
      const frame = requestAnimationFrame(scrollToTop);
      const timeouts = [
        setTimeout(scrollToTop, 500),
        setTimeout(scrollToTop, 1000),
        setTimeout(scrollToTop, 1500),
      ];

      return () => {
        cancelAnimationFrame(frame);
        timeouts.forEach(clearTimeout);
      };
    }, [scrollToTop]),
  );

  const handleInitialize = useCallback(() => {
    scrollToTop();
    void callAsync('initialize', () => initialize({ configUrl }));
  }, [callAsync, configUrl, scrollToTop]);

  const handleReset = useCallback(() => {
    try {
      reset();
      setResults({
        reset: { type: 'success', value: 'void (success)' },
      });
      scrollToTop();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setResults({
        reset: { type: 'error', error: message },
      });
    }
  }, [scrollToTop]);

  return (
    <View style={styles.screen}>
      <ScrollView
        key={scrollVersion}
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.content}
        onLayout={scrollToTop}
      >
        {/* Initialization */}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Initialization
        </Text>
        <View style={styles.section}>
          <Text style={styles.inputLabel}>Config URL:</Text>
          <TextInput
            style={styles.input}
            value={configUrl}
            onChangeText={setConfigUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://..."
            accessibilityLabel="Config URL"
            accessibilityHint="URL used to initialize the consent SDK"
            testID="input-config-url"
          />
          <APIButton label="initialize()" onPress={handleInitialize} />
          <ResultDisplay label="initialize" result={results['initialize'] ?? null} />

          <APIButton label="reset()" onPress={handleReset} />
          <ResultDisplay label="reset" result={results['reset'] ?? null} />
        </View>

        {/* Consent State */}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Consent State
        </Text>
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
            accessibilityLabel="Consent category"
            accessibilityHint="Category key used by isCategoryEnabled"
            testID="input-category"
          />
          <APIButton
            label="isCategoryEnabled()"
            onPress={() => callSync('isCategoryEnabled', () => isCategoryEnabled(categoryInput))}
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

          <APIButton label="getConfig()" onPress={() => callSync('getConfig', () => getConfig())} />
          <ResultDisplay label="getConfig" result={results['getConfig'] ?? null} />
        </View>

        {/* Consent Actions */}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Consent Actions
        </Text>
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
            accessibilityLabel="Preferences JSON"
            accessibilityHint="Preferences passed to savePreferences"
            testID="input-preferences"
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
            onPress={() => callAsync('retryPendingRequests', () => retryPendingRequests())}
          />
          <ResultDisplay
            label="retryPendingRequests"
            result={results['retryPendingRequests'] ?? null}
          />
        </View>

        {/* Tracking */}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Tracking
        </Text>
        <View style={styles.section}>
          <APIButton
            label="requestTrackingAuthorization()"
            onPress={() =>
              callAsync('requestTrackingAuthorization', () => requestTrackingAuthorization())
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
        <Text style={styles.sectionTitle} accessibilityRole="header">
          WebView
        </Text>
        <View style={styles.section}>
          <APIButton
            label="getConsentPayloadForWebView()"
            onPress={() =>
              callSync('getConsentPayloadForWebView', () => getConsentPayloadForWebView())
            }
          />
          <ResultDisplay
            label="getConsentPayloadForWebView"
            result={results['getConsentPayloadForWebView'] ?? null}
          />

          <APIButton
            label="getConsentInjectionScript()"
            onPress={() => callSync('getConsentInjectionScript', () => getConsentInjectionScript())}
          />
          <ResultDisplay
            label="getConsentInjectionScript"
            result={results['getConsentInjectionScript'] ?? null}
          />
        </View>

        {/* Events */}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Events
        </Text>
        <View style={styles.section}>
          <APIButton
            label="trackBannerShown()"
            onPress={() => callAsync('trackBannerShown', () => trackBannerShown())}
          />
          <ResultDisplay label="trackBannerShown" result={results['trackBannerShown'] ?? null} />
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
      <TouchableOpacity
        testID="btn-initialize-sticky"
        accessibilityRole="button"
        accessibilityLabel="Initialize SDK"
        accessibilityHint="Initializes the consent SDK and scrolls to the result"
        style={styles.stickyInitButton}
        onPress={handleInitialize}
        activeOpacity={0.85}
      >
        <Text style={styles.stickyInitText}>initialize()</Text>
      </TouchableOpacity>
    </View>
  );
}

interface APIButtonProps {
  label: string;
  onPress: () => void;
}

// Strip characters that Maestro would interpret as regex metacharacters (the
// `()` on method labels especially) so e2e selectors stay simple, e.g.
// "initialize()" -> "btn-initialize".
function toTestId(label: string): string {
  return `btn-${label.replace(/[^a-zA-Z0-9]+/g, '')}`;
}

function APIButton({ label, onPress }: APIButtonProps): React.JSX.Element {
  return (
    <TouchableOpacity
      testID={toTestId(label)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={`Runs the ${label} SDK method`}
      style={styles.button}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
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
  stickyInitButton: {
    position: 'absolute',
    top: 8,
    right: 16,
    zIndex: 2,
    backgroundColor: '#1565c0',
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    elevation: 3,
  },
  stickyInitText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
