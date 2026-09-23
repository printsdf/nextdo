/**
 * Tab bar (design.md §4): Inbox / Now / Projects / Review.
 *
 * Reordered with Inbox first for zero-friction GTD capture on launch.
 * iOS styled with subtle top border, clear active tint, and touch padding.
 */
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';
import { colors } from '@nextdo/ui';
export default function TabsLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? colors.accentDark : colors.accent,
        tabBarInactiveTintColor: isDark ? colors.mutedDark : colors.muted,
        tabBarIconStyle: { display: 'none' },
        tabBarStyle: {
          backgroundColor: isDark ? colors.surfaceDark : colors.surface,
          borderTopColor: isDark ? colors.borderDark : colors.border,
          borderTopWidth: 0.5,
          height: 52,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen name="inbox" options={{ title: '收件箱' }} />
      <Tabs.Screen name="now" options={{ title: '现在' }} />
      <Tabs.Screen name="projects" options={{ title: '项目' }} />
      <Tabs.Screen name="review" options={{ title: '回顾' }} />
    </Tabs>
  );
}
