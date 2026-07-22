import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface ResultDisplayProps {
  label: string;
  result: ResultValue | null;
}

interface SuccessResult {
  type: 'success';
  value: unknown;
}

interface ErrorResult {
  type: 'error';
  error: string;
}

export type ResultValue = SuccessResult | ErrorResult;

export function ResultDisplay({ label, result }: ResultDisplayProps): React.JSX.Element | null {
  if (!result) {
    return null;
  }

  const isError = result.type === 'error';
  const displayValue =
    result.type === 'success'
      ? typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value, null, 2)
      : result.error;

  // Encode the outcome in the testID (regex-safe: strip non-alphanumerics from
  // the label) so e2e flows can assert on `result-<label>-ok` / `-error`
  // directly via the resource-id.
  const safeLabel = label.replace(/[^a-zA-Z0-9]+/g, '');
  return (
    <View
      testID={`result-${safeLabel}-${isError ? 'error' : 'ok'}`}
      accessible
      accessibilityLabel={`${label}: ${isError ? 'error' : 'success'}. ${displayValue}`}
      accessibilityLiveRegion="polite"
      style={[styles.container, isError ? styles.errorContainer : styles.successContainer]}
    >
      <Text style={[styles.label, isError ? styles.errorLabel : styles.successLabel]}>
        {label}: {isError ? 'ERROR' : 'OK'}
      </Text>
      <Text style={[styles.value, isError ? styles.errorValue : styles.successValue]}>
        {displayValue}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  successContainer: {
    backgroundColor: '#e6f9e6',
    borderColor: '#4caf50',
  },
  errorContainer: {
    backgroundColor: '#fde6e6',
    borderColor: '#f44336',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  successLabel: {
    color: '#2e7d32',
  },
  errorLabel: {
    color: '#c62828',
  },
  value: {
    fontSize: 12,
    fontFamily: 'Menlo',
  },
  successValue: {
    color: '#1b5e20',
  },
  errorValue: {
    color: '#b71c1c',
  },
});
