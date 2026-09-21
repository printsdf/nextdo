/**
 * Tab bar (design.md §4): Now / Inbox / Projects / Review.
 *
 * Text labels only — no icon assets in the scaffold (the icon set lands with
 * the feature tasks); `headerShown: false` because the screens carry their
 * own titles.
 */
import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="now" options={{ title: 'Now' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      <Tabs.Screen name="review" options={{ title: 'Review' }} />
    </Tabs>
  );
}
