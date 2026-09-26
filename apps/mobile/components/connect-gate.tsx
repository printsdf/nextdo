/**
 * The ConnectGate (prod-deploy R3) — the full-screen first-launch
 * threshold: shown while no owner token is stored, or after a stored
 * token failed the startup pre-check. One input, one button, one inline
 * error. A successful connect does NOT dismiss the gate from here — the
 * RootLayout's owner-token subscription unmounts it (single owner of the
 * auth state machine).
 *
 * Presentational by contract (component-guidelines): no packages/db
 * imports, no network calls. The RootLayout passes `onConnect`, which
 * runs `fetchCredentialsOnce` + `setOwnerToken` and maps the outcome to
 * the user-facing copy (token 不正确 / 连不上服务器).
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { Button } from '@nextdo/ui';

/** The user-facing outcome of a connect attempt (never throws). */
export type ConnectGateResult =
  | { ok: true }
  | { ok: false; message: string };

export interface ConnectGateProps {
  /** Validate the entered token (one /credentials round-trip) and store
   *  it on success; resolve with the outcome to show inline. */
  onConnect: (token: string) => Promise<ConnectGateResult>;
  /** Inline error shown BEFORE the first submit (e.g. 「token 无效，请重新输入」
   *  after the startup pre-check rejected the stored token). */
  initialError?: string;
}

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted shadow-sm focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

export function ConnectGate({ onConnect, initialError }: ConnectGateProps) {
  const [value, setValue] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const canSubmit = value.trim() !== '' && !isConnecting;

  const handleSubmit = async (): Promise<void> => {
    const token = value.trim();
    if (token === '' || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      const result = await onConnect(token);
      // ok → the RootLayout's owner-token subscription unmounts this gate.
      if (!result.ok) {
        setError(result.message);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-canvas dark:bg-canvas-dark"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 items-center justify-center p-6">
        <View className="items-center gap-2">
          <Text className="font-display text-2xl font-semibold text-ink dark:text-ink-dark">
            连接你的服务器
          </Text>
          <Text className="text-center font-sans text-sm text-muted dark:text-muted-dark">
            输入部署时生成的 owner token，之后设备与服务器自动同步。
          </Text>
        </View>
        <View className="mt-8 w-full gap-3">
          <TextInput
            className={INPUT_CLASS}
            placeholder="owner token"
            value={value}
            onChangeText={setValue}
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
            label={isConnecting ? '连接中…' : '连接'}
            size="lg"
            disabled={!canSubmit}
            onPress={() => {
              void handleSubmit();
            }}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
