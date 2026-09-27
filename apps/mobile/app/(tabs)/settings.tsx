/**
 * The Settings tab (prod-deploy R6 — cloud sync is OPTIONAL): the 5th tab.
 * v1 hosts ONE block: cloud sync.
 *
 * - disconnected (no owner token): explains local-only mode + token input
 *   + 连接 + inline error (the R3 three-state copy: token 不正确 /
 *   连不上服务器，请稍后重试);
 * - connected: status line + 断开连接 (clears the token — the provider's
 *   subscription then disconnects sync; local data is untouched, so no
 *   confirmation is needed in v1).
 *
 * All auth work goes through the `useCloudSync` UI hook (the packages/db
 * boundary); this screen owns only the form's transient state.
 */
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Card } from '@nextdo/ui';
import { useCloudSync } from '@/hooks/use-cloud-sync';

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted shadow-sm focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

export default function SettingsScreen() {
  const { state, connect, disconnect } = useCloudSync();
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = token.trim() !== '' && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await connect(token);
      // ok → the hook's owner-token subscription flips the block to the
      // connected view (the input unmounts with it).
      if (result.ok) {
        setToken('');
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      {/* Header block (matches the other tabs) */}
      <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
        设置
      </Text>
      <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
        设备与云同步。
      </Text>

      {/* Cloud sync block (R6) */}
      <Card className="mt-4 gap-3 p-3.5">
        <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
          云同步
        </Text>
        {state === 'loading' ? (
          <Text className="font-sans text-sm text-muted dark:text-muted-dark">
            检查中…
          </Text>
        ) : state === 'connected' ? (
          <View className="gap-3">
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              已连接 — 数据在这台设备与服务器之间自动同步。
            </Text>
            <Button
              label="断开连接"
              variant="secondary"
              onPress={() => {
                void disconnect();
              }}
            />
          </View>
        ) : (
          <View className="gap-3">
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              未连接 — 数据仅保存在这台设备上。输入部署时生成的 owner
              token 即可开启同步。
            </Text>
            <TextInput
              className={INPUT_CLASS}
              placeholder="owner token"
              value={token}
              onChangeText={(next) => {
                setToken(next);
                if (error !== null) setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="go"
              onSubmitEditing={() => {
                void handleSubmit();
              }}
              accessibilityLabel="owner token"
            />
            {error !== null ? (
              <Text className="font-sans text-sm text-danger dark:text-danger-dark">
                {error}
              </Text>
            ) : null}
            <Button
              label={submitting ? '连接中…' : '连接'}
              disabled={!canSubmit}
              onPress={() => {
                void handleSubmit();
              }}
            />
          </View>
        )}
      </Card>
    </View>
  );
}
