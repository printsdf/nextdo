/**
 * The Settings tab (prod-deploy R6 — cloud sync is OPTIONAL; OSS
 * task 09-28 — the server addresses are USER-CONFIGURED): the 5th tab.
 * v1 hosts ONE block: cloud sync.
 *
 * - disconnected (no owner token): explains local-only mode + three inputs
 *   (backend address, sync-stream address, owner token — OPTIONAL on the
 *   first connect: an empty token triggers the one-time server-side claim,
 *   the minted token fills this device automatically) + 连接 + inline
 *   error. The two address inputs pre-fill from the stored config when it
 *   exists (so a reconnect after 断开 only needs a new token).
 *   Client-side validation (请先填写服务器地址 / 地址无效…) runs BEFORE
 *   any network; the server three-state copy (token 不正确 /
 *   连不上服务器，请稍后重试) is unchanged, the claim adds 「服务器已有
 *   token，请手动输入」for the 409.
 * - connected: status line + the two stored addresses (read-only) +
 *   断开连接 (clears the token — the addresses are KEPT; the provider's
 *   subscription then disconnects sync; local data is untouched, so no
 *   confirmation is needed in v1).
 *
 * All auth work goes through the `useCloudSync` UI hook (the packages/db
 * boundary); this screen owns only the form's transient state.
 */
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Card } from '@nextdo/ui';
import { useCloudSync } from '@/hooks/use-cloud-sync';

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted shadow-sm focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

export default function SettingsScreen() {
  const { state, storedConfig, connect, disconnect } = useCloudSync();
  const [backendUrl, setBackendUrl] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill the two address inputs from the stored config when it exists —
  // into EMPTY fields only (a reconnect after 断开 keeps the addresses, so
  // the user never re-types them). `storedConfig` re-reads on every poke, so
  // this also runs when the block flips back to disconnected.
  useEffect(() => {
    if (storedConfig === null) return;
    setBackendUrl((prev) => (prev === '' ? storedConfig.backendUrl : prev));
    setEndpoint((prev) => (prev === '' ? storedConfig.endpoint : prev));
  }, [storedConfig]);

  // The two addresses non-empty (token is OPTIONAL — an empty token is a
  // legal first-connect submit: it triggers the server-side claim).
  // Address VALIDITY is left to connect's inline error, not the button.
  const canSubmit = backendUrl.trim() !== '' && endpoint.trim() !== '' && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await connect({ backendUrl, endpoint, token });
      // ok → the hook's owner-token subscription flips the block to the
      // connected view (the inputs unmount with it).
      if (result.ok) {
        setToken('');
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const clearError = (): void => {
    if (error !== null) setError(null);
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
            {storedConfig !== null ? (
              <View className="gap-1">
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  后端地址：{storedConfig.backendUrl}
                </Text>
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  同步流地址：{storedConfig.endpoint}
                </Text>
              </View>
            ) : null}
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
              未连接 — 数据仅保存在这台设备上。填写你的同步服务器地址与 owner
              token 即可开启同步（首次连接 token 可留空，自动获取）。
            </Text>
            <TextInput
              className={INPUT_CLASS}
              placeholder="https://nextdo.example.com/api"
              value={backendUrl}
              onChangeText={(next) => {
                setBackendUrl(next);
                clearError();
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              accessibilityLabel="后端地址"
            />
            <TextInput
              className={INPUT_CLASS}
              placeholder="https://nextdo.example.com/sync"
              value={endpoint}
              onChangeText={(next) => {
                setEndpoint(next);
                clearError();
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              accessibilityLabel="同步流地址"
            />
            <TextInput
              className={INPUT_CLASS}
              placeholder="owner token（首次连接可留空，自动获取）"
              value={token}
              onChangeText={(next) => {
                setToken(next);
                clearError();
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
