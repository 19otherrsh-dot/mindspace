import { Platform, StyleSheet, Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from '@/theme/use-theme';
import { typography } from '@/theme';

/** The five-tab bar specified for every main screen in the PRD. */
const TABS = [
  { name: 'index', title: 'Today', glyph: '◉' },
  { name: 'explore', title: 'Explore', glyph: '✦' },
  { name: 'courses', title: 'Courses', glyph: '❑' },
  { name: 'stats', title: 'Stats', glyph: '◴' },
  { name: 'profile', title: 'Profile', glyph: '☺' },
] as const;

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundElevated,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          // The default bar is cramped once labels are showing.
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 8,
        },
        tabBarLabelStyle: typography.micro,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color }) => (
              <Text style={{ fontSize: 20, color, lineHeight: 24 }}>{tab.glyph}</Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
