import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { getPreferences, getConfig, onConsentChanged } from '@datagrail/react-native-consent';
import type { ConsentPreferences, ConsentConfig } from '@datagrail/react-native-consent';
import { JsonViewer } from '../components/JsonViewer';
import { EventLog } from '../components/EventLog';
import { createLogEntry } from '../utils/mockConfig';
import type { LogEntry } from '../utils/mockConfig';

export function StateInspectorScreen(): React.JSX.Element {
  const [preferences, setPreferences] = useState<ConsentPreferences | null>(null);
  const [config, setConfig] = useState<ConsentConfig | null>(null);
  const [eventLog, setEventLog] = useState<LogEntry[]>([]);

  const refreshState = useCallback(() => {
    try {
      setPreferences(getPreferences());
    } catch {
      setPreferences(null);
    }
    try {
      setConfig(getConfig());
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    refreshState();

    const unsubscribe = onConsentChanged((prefs: ConsentPreferences) => {
      setPreferences(prefs);
      setEventLog((prev) => [...prev, createLogEntry('event', 'Consent changed', prefs)]);
    });

    return unsubscribe;
  }, [refreshState]);

  // Periodically refresh in case state changes from other interactions
  useEffect(() => {
    const interval = setInterval(refreshState, 2000);
    return () => clearInterval(interval);
  }, [refreshState]);

  const configVersion = config?.version ?? 'N/A';
  const consentContainerId = config?.consentContainerVersionId ?? 'N/A';
  const customerId = config?.dgCustomerId ?? 'N/A';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        Consent State Inspector
      </Text>

      {/* Metadata */}
      <View style={styles.metaSection}>
        <MetaRow label="Config Version" value={configVersion} />
        <MetaRow label="Container ID" value={consentContainerId} />
        <MetaRow label="Customer ID" value={customerId} />
        <MetaRow label="Consent Mode" value={config?.consentMode ?? 'N/A'} />
        <MetaRow
          label="Show Banner"
          value={config?.showBanner != null ? String(config.showBanner) : 'N/A'}
        />
      </View>

      {/* Current Preferences */}
      <JsonViewer label="Current Preferences" data={preferences} />

      {/* Config Cache */}
      <JsonViewer label="Config Cache" data={config} collapsible defaultCollapsed />

      {/* Event Log */}
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Event Log
      </Text>
      <EventLog entries={eventLog} maxHeight={300} />

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

interface MetaRowProps {
  label: string;
  value: string;
}

function MetaRow({ label, value }: MetaRowProps): React.JSX.Element {
  const testId = `state-${label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
  return (
    <View
      style={styles.metaRow}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={testId}
    >
      <Text style={styles.metaLabel}>{label}:</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
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
  metaSection: {
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
    width: 120,
  },
  metaValue: {
    fontSize: 12,
    fontFamily: 'Menlo',
    color: '#333',
    flex: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  bottomPad: {
    height: 40,
  },
});
