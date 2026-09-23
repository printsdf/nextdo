/**
 * Re-clarify wizard route (design.md §2): the engine-triggered re-entry at
 * Q2 for an existing action (consecutiveSkips ≥ RECLARIFY_THRESHOLD). The
 * action kind arrives as `?kind=next|calendar` — habits are rejected before
 * navigation (the engine never offers re-clarify for a habit day).
 */
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ClarifyWizard } from '@/components/clarify-wizard';

export default function ReclarifyScreen() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const actionKind = kind === 'next' || kind === 'calendar' ? kind : null;
  return (
    <View className="flex-1 bg-canvas dark:bg-canvas-dark">
      <ClarifyWizard mode="reclarify" id={typeof id === 'string' ? id : null} actionKind={actionKind} />
    </View>
  );
}
