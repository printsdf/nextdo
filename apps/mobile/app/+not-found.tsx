/**
 * Route not found (Expo Router catch-all — must default-export).
 */
import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 items-center justify-center gap-4 bg-canvas p-8 dark:bg-canvas-dark">
        <Text className="text-base font-medium text-ink dark:text-ink-dark">
          This screen does not exist.
        </Text>
        <Link href="/(tabs)/now" className="text-base text-accent dark:text-accent-dark">
          Go to the Now tab
        </Link>
      </View>
    </>
  );
}
