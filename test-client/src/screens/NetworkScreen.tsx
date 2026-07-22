import React, { useState, useCallback } from 'react';
import { View, Text, Switch, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { retryPendingRequests, reset } from '@datagrail/react-native-consent';
import { ResultDisplay } from '../components/ResultDisplay';
import type { ResultValue } from '../components/ResultDisplay';
import { EventLog } from '../components/EventLog';
import { createLogEntry } from '../utils/mockConfig';
import type { LogEntry } from '../utils/mockConfig';

export function NetworkScreen(): React.JSX.Element {
  const [offlineMode, setOfflineMode] = useState(false);
  const [results, setResults] = useState<Record<string, ResultValue | null>>({});
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const addEvent = useCallback((type: LogEntry['type'], message: string, data?: unknown) => {
    setEvents((prev) => [...prev, createLogEntry(type, message, data)]);
  }, []);

  const handleToggleOffline = useCallback(
    (value: boolean) => {
      setOfflineMode(value);
      addEvent('info', `Offline mode ${value ? 'ENABLED' : 'DISABLED'}`);
    },
    [addEvent],
  );

  const handleDrainQueue = useCallback(async () => {
    try {
      addEvent('info', 'Draining queue...');
      const result = await retryPendingRequests();
      setResults((prev) => ({
        ...prev,
        drain: { type: 'success', value: result },
      }));
      addEvent('success', `Queue drained: ${result.success} succeeded, ${result.failed} failed`);
      setLastError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setResults((prev) => ({
        ...prev,
        drain: { type: 'error', error: message },
      }));
      addEvent('error', `Drain failed: ${message}`);
      setLastError(message);
    }
  }, [addEvent]);

  const handleQueueStatus = useCallback(async () => {
    try {
      const result = await retryPendingRequests();
      setResults((prev) => ({
        ...prev,
        status: { type: 'success', value: result },
      }));
      addEvent('info', `Queue status: ${result.success} success, ${result.failed} failed`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setResults((prev) => ({
        ...prev,
        status: { type: 'error', error: message },
      }));
      addEvent('error', `Status check failed: ${message}`);
      setLastError(message);
    }
  }, [addEvent]);

  const handleClearAll = useCallback(() => {
    try {
      reset();
      setResults({});
      setLastError(null);
      addEvent('success', 'All data cleared via reset()');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addEvent('error', `Clear failed: ${message}`);
      setLastError(message);
    }
  }, [addEvent]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        Network Control Panel
      </Text>

      {/* Offline Mode Toggle */}
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View>
            <Text style={styles.toggleLabel}>Offline Mode</Text>
            <Text style={styles.toggleDescription}>
              Simulate network unavailability for testing offline queue behavior
            </Text>
          </View>
          <Switch
            testID="toggle-offline"
            accessibilityRole="switch"
            accessibilityLabel="Offline mode"
            accessibilityHint="Simulates network unavailability in this test client"
            accessibilityState={{ checked: offlineMode }}
            value={offlineMode}
            onValueChange={handleToggleOffline}
            trackColor={{ false: '#ccc', true: '#81c784' }}
            thumbColor={offlineMode ? '#4caf50' : '#f4f3f4'}
          />
        </View>
        {offlineMode && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>OFFLINE MODE ACTIVE — requests will be queued</Text>
          </View>
        )}
      </View>

      {/* Queue Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          Queue Management
        </Text>

        <TouchableOpacity
          testID="btn-check-queue-status"
          accessibilityRole="button"
          accessibilityLabel="Check queue status"
          style={styles.button}
          onPress={handleQueueStatus}
        >
          <Text style={styles.buttonText}>Check Queue Status</Text>
        </TouchableOpacity>
        <ResultDisplay label="Queue Status" result={results['status'] ?? null} />

        <TouchableOpacity
          testID="btn-drain-queue"
          accessibilityRole="button"
          accessibilityLabel="Drain queue"
          style={[styles.button, styles.primaryButton]}
          onPress={handleDrainQueue}
        >
          <Text style={styles.buttonText}>Drain Queue</Text>
        </TouchableOpacity>
        <ResultDisplay label="Drain Queue" result={results['drain'] ?? null} />

        <TouchableOpacity
          testID="btn-clear-all-data"
          accessibilityRole="button"
          accessibilityLabel="Clear all data"
          accessibilityHint="Resets all consent SDK data"
          style={[styles.button, styles.dangerButton]}
          onPress={handleClearAll}
        >
          <Text style={styles.buttonText}>Clear All Data</Text>
        </TouchableOpacity>
      </View>

      {/* Last Network Error */}
      {lastError && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Last Network Error</Text>
          <Text style={styles.errorMessage}>{lastError}</Text>
        </View>
      )}

      {/* Activity Log */}
      <Text style={styles.sectionLabel}>Activity Log</Text>
      <EventLog entries={events} maxHeight={250} />

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  toggleDescription: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    maxWidth: 250,
  },
  warningBanner: {
    marginTop: 12,
    backgroundColor: '#fff3e0',
    borderRadius: 4,
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff9800',
  },
  warningText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#e65100',
  },
  button: {
    backgroundColor: '#607d8b',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 4,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#2196f3',
  },
  dangerButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: '#fde6e6',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#f44336',
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c62828',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 12,
    fontFamily: 'Menlo',
    color: '#b71c1c',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginTop: 4,
  },
  bottomPad: {
    height: 40,
  },
});
