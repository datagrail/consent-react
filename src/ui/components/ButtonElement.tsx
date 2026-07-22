import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { ButtonAction } from '../../types';
import type { BannerTheme } from '../theme';

interface ButtonElementProps {
  text: string;
  action: ButtonAction;
  theme: BannerTheme;
  onPress: (action: ButtonAction) => void;
}

export function ButtonElement({
  text,
  action,
  theme,
  onPress,
}: ButtonElementProps): React.ReactElement {
  const isPrimary = action === 'accept_all' || action === 'custom';
  const actionTestId = `banner-action-${action.replace(/_/g, '-')}`;

  const buttonStyle = [
    styles.button,
    {
      backgroundColor: isPrimary ? theme.colors.buttonPrimary : theme.colors.buttonSecondary,
      borderRadius: theme.borderRadius,
      paddingVertical: theme.spacing.sm + 4,
      paddingHorizontal: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
  ];

  const textStyle = {
    color: isPrimary ? theme.colors.buttonPrimaryText : theme.colors.buttonSecondaryText,
    fontSize: theme.fontSize.button,
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
  };

  return (
    <TouchableOpacity
      style={buttonStyle}
      onPress={() => onPress(action)}
      accessibilityRole="button"
      accessibilityLabel={text}
      testID={actionTestId}
    >
      <Text style={textStyle}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
