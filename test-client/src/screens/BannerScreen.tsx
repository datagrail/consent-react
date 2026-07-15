import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Banner, PreferenceCenter } from '@datagrail/react-native-consent';
import type { ConsentPreferences } from '@datagrail/react-native-consent';
import { EventLog } from '../components/EventLog';
import { createLogEntry } from '../utils/mockConfig';
import type { LogEntry } from '../utils/mockConfig';

type ViewMode = 'banner' | 'preferenceCenter';

const LOCALES = ['en', 'fr', 'de', 'es'] as const;
type Locale = (typeof LOCALES)[number];

export function BannerScreen(): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('banner');
  const [locale, setLocale] = useState<Locale>('en');
  const [events, setEvents] = useState<LogEntry[]>([]);

  const addEvent = useCallback((type: LogEntry['type'], message: string, data?: unknown) => {
    setEvents((prev) => [...prev, createLogEntry(type, message, data)]);
  }, []);

  const handleConsentSaved = useCallback(
    (prefs: ConsentPreferences) => {
      addEvent('success', 'onConsentSaved', prefs);
    },
    [addEvent],
  );

  const handleDismiss = useCallback(() => {
    addEvent('info', 'onDismiss');
  }, [addEvent]);

  const handleSave = useCallback(
    (prefs: ConsentPreferences) => {
      addEvent('success', 'onSave', prefs);
    },
    [addEvent],
  );

  const handleCancel = useCallback(() => {
    addEvent('info', 'onCancel');
  }, [addEvent]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Banner / Preference Center</Text>

      {/* View Mode Toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'banner' && styles.toggleActive]}
          onPress={() => setViewMode('banner')}
        >
          <Text
            style={[
              styles.toggleText,
              viewMode === 'banner' && styles.toggleTextActive,
            ]}
          >
            Banner
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleBtn,
            viewMode === 'preferenceCenter' && styles.toggleActive,
          ]}
          onPress={() => setViewMode('preferenceCenter')}
        >
          <Text
            style={[
              styles.toggleText,
              viewMode === 'preferenceCenter' && styles.toggleTextActive,
            ]}
          >
            Preference Center
          </Text>
        </TouchableOpacity>
      </View>

      {/* Locale Selector */}
      <Text style={styles.sectionLabel}>Locale:</Text>
      <View style={styles.localeRow}>
        {LOCALES.map((loc) => (
          <TouchableOpacity
            key={loc}
            style={[styles.localeBtn, locale === loc && styles.localeBtnActive]}
            onPress={() => setLocale(loc)}
          >
            <Text
              style={[
                styles.localeText,
                locale === loc && styles.localeTextActive,
              ]}
            >
              {loc.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Component Display */}
      <View style={styles.componentContainer}>
        {viewMode === 'banner' ? (
          <Banner
            onConsentSaved={handleConsentSaved}
            onDismiss={handleDismiss}
            locale={locale}
          />
        ) : (
          <PreferenceCenter
            onSave={handleSave}
            onCancel={handleCancel}
            locale={locale}
            showTrackingDetails
          />
        )}
      </View>

      {/* Callback Events */}
      <Text style={styles.sectionLabel}>Callback Events:</Text>
      <EventLog entries={events} maxHeight={200} />

      <View style={styles.bottomPad} />
    </ScrollView>
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2196f3',
    overflow: 'hidden',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  toggleActive: {
    backgroundColor: '#2196f3',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2196f3',
  },
  toggleTextActive: {
    color: '#fff',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginTop: 12,
  },
  localeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  localeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  localeBtnActive: {
    borderColor: '#2196f3',
    backgroundColor: '#e3f2fd',
  },
  localeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  localeTextActive: {
    color: '#2196f3',
  },
  componentContainer: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fafafa',
    // Banner renders as a position: absolute overlay, so it doesn't grow this
    // container — a short minHeight clips real configs with more than a
    // couple of buttons/categories (confirmed manually against a live config).
    minHeight: 700,
    marginBottom: 16,
  },
  bottomPad: {
    height: 40,
  },
});
