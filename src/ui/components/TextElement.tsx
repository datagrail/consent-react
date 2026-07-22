import React from 'react';
import { Text } from 'react-native';
import type { BannerTheme } from '../theme';

interface TextElementProps {
  text: string;
  style: string | null | undefined;
  theme: BannerTheme;
}

export function TextElement({ text, style, theme }: TextElementProps): React.ReactElement {
  const textStyle = getTextStyle(style, theme);
  const isHeading = style === 'dg-title' || style === 'dg-header';
  return (
    <Text style={textStyle} accessibilityRole={isHeading ? 'header' : 'text'}>
      {text}
    </Text>
  );
}

function getTextStyle(
  style: string | null | undefined,
  theme: BannerTheme,
): { fontSize: number; fontWeight: 'bold' | 'normal'; color: string; marginBottom: number } {
  switch (style) {
    case 'dg-title':
      return {
        fontSize: theme.fontSize.title,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginBottom: theme.spacing.md,
      };
    case 'dg-header':
      return {
        fontSize: theme.fontSize.title - 2,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginBottom: theme.spacing.sm,
      };
    case 'dg-main-content-explanation':
      return {
        fontSize: theme.fontSize.body,
        fontWeight: 'normal',
        color: theme.colors.text,
        marginBottom: theme.spacing.md,
      };
    default:
      return {
        fontSize: theme.fontSize.body,
        fontWeight: 'normal',
        color: theme.colors.text,
        marginBottom: theme.spacing.sm,
      };
  }
}
