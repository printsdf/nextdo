import { useContext } from 'react';
import { EdgeInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';

const DEFAULT_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Safe area insets hook that gracefully falls back to zero-insets
 * when rendered in test environments without a `<SafeAreaProvider>`.
 */
export function useAppInsets(): EdgeInsets {
  const insets = useContext(SafeAreaInsetsContext);
  return insets ?? DEFAULT_INSETS;
}
