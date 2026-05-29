import React from 'react';
import { View, Text } from 'react-native';
import type { BannerProps } from '../types';

/**
 * Config-driven consent banner component.
 * Renders text, buttons, links from remote config.
 * Supports position variants, animations, and accessibility.
 */
export function Banner(_props: BannerProps): React.ReactElement | null {
  // TODO: Agent implements — full config-driven banner
  return (
    <View>
      <Text>Banner placeholder</Text>
    </View>
  );
}
