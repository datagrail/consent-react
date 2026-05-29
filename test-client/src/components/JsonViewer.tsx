import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface JsonViewerProps {
  label: string;
  data: unknown;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function JsonViewer({
  label,
  data,
  collapsible = false,
  defaultCollapsed = true,
}: JsonViewerProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const formatted =
    data === null || data === undefined
      ? String(data)
      : JSON.stringify(data, null, 2);

  const header = (
    <View style={styles.header}>
      <Text style={styles.label}>{label}</Text>
      {collapsible && (
        <Text style={styles.toggle}>{collapsed ? '[+]' : '[-]'}</Text>
      )}
    </View>
  );

  if (collapsible) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setCollapsed((c) => !c)}>
          {header}
        </TouchableOpacity>
        {!collapsed && <Text style={styles.json}>{formatted}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <Text style={styles.json}>{formatted}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    backgroundColor: '#f9f9f9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  toggle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  json: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: 'Menlo',
    color: '#444',
    lineHeight: 16,
  },
});
