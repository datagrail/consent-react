import React, { useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import type { LogEntry } from '../utils/mockConfig';

interface EventLogProps {
  entries: LogEntry[];
  maxHeight?: number;
}

export function EventLog({ entries, maxHeight = 200 }: EventLogProps): React.JSX.Element {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollToEnd({ animated: true });
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <View style={[styles.container, { maxHeight }]}>
        <Text style={styles.empty}>No events yet</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.container, { maxHeight }]}
      nestedScrollEnabled
    >
      {entries.map((entry) => (
        <View key={entry.id} style={styles.entry}>
          <Text style={[styles.badge, styles[`badge_${entry.type}`]]}>
            {entry.type.toUpperCase()}
          </Text>
          <Text style={styles.timestamp}>
            {entry.timestamp.toLocaleTimeString()}
          </Text>
          <Text style={styles.message}>{entry.message}</Text>
          {entry.data !== undefined && (
            <Text style={styles.data}>
              {typeof entry.data === 'string'
                ? entry.data
                : JSON.stringify(entry.data, null, 2)}
            </Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    backgroundColor: '#fafafa',
  },
  empty: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 16,
  },
  entry: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  badge: {
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    alignSelf: 'flex-start',
    overflow: 'hidden',
    marginBottom: 2,
  },
  badge_info: {
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
  },
  badge_success: {
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
  },
  badge_error: {
    backgroundColor: '#fce4ec',
    color: '#c62828',
  },
  badge_event: {
    backgroundColor: '#f3e5f5',
    color: '#6a1b9a',
  },
  timestamp: {
    fontSize: 10,
    color: '#888',
    marginBottom: 2,
  },
  message: {
    fontSize: 12,
    color: '#333',
  },
  data: {
    fontSize: 10,
    fontFamily: 'Menlo',
    color: '#555',
    marginTop: 4,
    backgroundColor: '#f5f5f5',
    padding: 4,
    borderRadius: 2,
  },
});
