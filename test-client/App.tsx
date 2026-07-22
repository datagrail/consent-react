import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { APIExerciseScreen } from './src/screens/APIExerciseScreen';
import { StateInspectorScreen } from './src/screens/StateInspectorScreen';
import { BannerScreen } from './src/screens/BannerScreen';
import { NetworkScreen } from './src/screens/NetworkScreen';
import { installE2EFetchFixtures } from './src/utils/e2eFetchFixtures';

const Tab = createBottomTabNavigator();

// Debug-only: the e2e fixtures permanently override global.fetch, so keep them
// out of release builds where the real network implementation must be used.
// Maestro flows run against debug builds, so e2e coverage is unaffected.
if (__DEV__) {
  installE2EFetchFixtures();
}

function TabIcon({ label }: { label: string }): React.JSX.Element {
  return <Text style={{ fontSize: 18 }}>{label}</Text>;
}

export function App(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerTitleStyle: { fontSize: 15, fontWeight: '600' },
          tabBarLabelStyle: { fontSize: 10 },
          tabBarActiveTintColor: '#2196f3',
          tabBarInactiveTintColor: '#999',
        }}
      >
        <Tab.Screen
          name="API"
          component={APIExerciseScreen}
          options={{
            title: 'API Exercise',
            tabBarIcon: () => <TabIcon label={'\u{1F527}'} />,
            tabBarAccessibilityLabel: 'API Exercise tab',
            tabBarTestID: 'tab-api',
          }}
        />
        <Tab.Screen
          name="State"
          component={StateInspectorScreen}
          options={{
            title: 'State Inspector',
            tabBarIcon: () => <TabIcon label={'\u{1F50D}'} />,
            tabBarAccessibilityLabel: 'State Inspector tab',
            tabBarTestID: 'tab-state',
          }}
        />
        <Tab.Screen
          name="Banner"
          component={BannerScreen}
          options={{
            title: 'Banner',
            tabBarIcon: () => <TabIcon label={'\u{1F4CB}'} />,
            tabBarAccessibilityLabel: 'Banner tab',
            tabBarTestID: 'tab-banner',
          }}
        />
        <Tab.Screen
          name="Network"
          component={NetworkScreen}
          options={{
            title: 'Network',
            tabBarIcon: () => <TabIcon label={'\u{1F4E1}'} />,
            tabBarAccessibilityLabel: 'Network tab',
            tabBarTestID: 'tab-network',
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
