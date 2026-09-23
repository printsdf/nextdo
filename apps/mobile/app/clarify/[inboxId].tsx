/**
 * Clarify wizard route (design.md §2): full Q1–Q5 decision-table walk for an
 * InboxItem. Modal-style full screen — the root layout is headerless, the
 * wizard draws its own back button.
 */
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ClarifyWizard } from '@/components/clarify-wizard';

export default function ClarifyScreen() {
  const { inboxId } = useLocalSearchParams<{ inboxId: string }>();
  return (
    <View className="flex-1 bg-canvas dark:bg-canvas-dark">
      <ClarifyWizard mode="clarify" id={typeof inboxId === 'string' ? inboxId : null} />
    </View>
  );
}
