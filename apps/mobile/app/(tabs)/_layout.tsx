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
      <Tabs.Screen name="now" options={{ title: '现在' }} />
      <Tabs.Screen name="inbox" options={{ title: '收件箱' }} />
      <Tabs.Screen name="projects" options={{ title: '项目' }} />
      <Tabs.Screen name="review" options={{ title: '回顾' }} />
    </Tabs>
  );
}
