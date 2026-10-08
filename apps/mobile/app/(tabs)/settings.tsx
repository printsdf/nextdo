/**
 * The Settings tab (prod-deploy R6 — cloud sync is OPTIONAL; OSS
 * task 09-28 — the server addresses are USER-CONFIGURED): the 5th tab.
 * Hosts appearance/theme, notifications (task 09-30 R5 — delivery
 * status) and cloud sync.
 *
 * - appearance: system / light / dark preference selector.
 * - notifications: the OS permission state through `useReminderPermission`
 *   (never the platform modules — component-guidelines): undetermined /
 *   granted / denied per platform; denied on iOS → 「去系统设置」 button,
 *   denied on Android → text guidance (no API to jump there in v1);
 *   tauri → "follows the system settings"; plain web → "not supported".
 * - disconnected (no owner token): explains local-only mode + TWO inputs —
 *   ONE 「服务器地址」 (the `/api` + `/sync` paths are derived from it by
 *   `deriveSyncConfig`, in `packages/db`) and ONE 「连接串 / owner token」
 *   field that accepts either a pasted connection string
 *   (`<base>|<token>` or `nextdo://sync?s=&t=`) or a bare owner token — an
 *   empty token is refused by connect() with an inline error before any
 *   network. A 「高级设置」 accordion (collapsed by default) keeps the two
 *   original custom URL inputs for non-standard reverse-proxy layouts;
 *   filling BOTH makes them win over the derivation (design D2 — no
 *   extra mode toggle). A pre-existing stored config pre-fills all three
 *   address fields, so a reconnect after 断开 only needs a new token.
 *   Client-side validation (请先填写服务器地址 / 地址无效… / 请先输入
 *   owner token) runs BEFORE any network; the server three-state copy
 *   (token 不正确 / 连不上服务器，请稍后重试 / 保存失败) is unchanged.
 * - connected: status line + the two stored addresses (read-only) +
 *   断开连接 (clears the token — the addresses are KEPT; the provider's
 *   subscription then disconnects sync; local data is untouched, so no
 *   confirmation is needed in v1).
 *
 * All auth work goes through the `useCloudSync` UI hook (the packages/db
 * boundary); this screen owns only the form's transient state.
 */
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme, type ThemePreference } from '@/lib/theme';
import { Button, Card, cn } from '@nextdo/ui';
import { useCloudSync } from '@/hooks/use-cloud-sync';
import { useReminderPermission } from '@/hooks/use-reminder-permission';
import {
  formatConnectionString,
  formatDeepLink,
  parseConnectionString,
} from '@/lib/sync-connection';
import { QRCode } from '@/components/qr-code';

/**
 * Recover the BASE server address from a stored `backendUrl` so the single
 * 「服务器地址」 input can be pre-filled without the user seeing the
 * derived `/api` suffix they never typed. Purely cosmetic (the input
 * still connects fine with `/api` pasted — `deriveSyncConfig` strips it),
 * but showing a value the user never entered in a field labeled 「服务器
 * 地址」 is confusing. Mirrors `deriveSyncConfig`'s tolerated suffixes;
 * kept local because it is a DISPLAY concern, not a config rule.
 */
function stripDerivedSuffix(backendUrl: string): string {
  return backendUrl.replace(/\/+$/, '').replace(/\/(api|sync)$/, '');
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色模式' },
  { value: 'dark', label: '深色模式' },
];

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted shadow-sm focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** Placeholders / accessibility labels — the single definitions the tests
 *  match on (a duplicated literal in the JSX is how copy drifts). */
const SERVER_ADDRESS_PLACEHOLDER = 'https://nextdo.example.com';
const TOKEN_PLACEHOLDER = 'owner token 或连接串';
const ADVANCED_BACKEND_PLACEHOLDER = 'https://nextdo.example.com/api';
const ADVANCED_ENDPOINT_PLACEHOLDER = 'https://nextdo.example.com/sync';
const TOKEN_ACCESSIBILITY_LABEL = '连接串或 owner token';

export default function SettingsScreen() {
  const { preference, updatePreference } = useAppTheme();
  const { state, storedConfig, ownerToken, connect, disconnect } = useCloudSync();
  const { state: notificationPermission, openSystemSettings } = useReminderPermission();
  // The deep-link route (`app/sync.tsx`) hands a failed connect back here
  // as `?syncError=…` so the user SEES the reason instead of a silent
  // no-op. Read once per arrival (the value is a fresh string each time).
  const { syncError } = useLocalSearchParams<{ syncError?: string }>();
  // The simple form: ONE server address (the two URLs are derived from it)
  // plus one field that accepts a connection string OR a bare owner token.
  const [serverAddress, setServerAddress] = useState('');
  const [token, setToken] = useState('');
  // The advanced form (collapsed by default): the two custom URLs. Empty
  // means "derive them"; non-empty means "use exactly these" (design D2 —
  // no extra "I am in advanced mode" toggle, which would be a second state
  // that can disagree with the fields themselves).
  const [advancedBackendUrl, setAdvancedBackendUrl] = useState('');
  const [advancedEndpoint, setAdvancedEndpoint] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Set the moment the user edits the server address: from then on the
  // prefilled advanced pair no longer takes precedence (see the prefill
  // effect + handleServerAddressChange below).
  const [addressIsAuthoritative, setAddressIsAuthoritative] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const baseServerAddress = storedConfig ? stripDerivedSuffix(storedConfig.backendUrl) : '';
  const exportedConnectionString =
    storedConfig && ownerToken ? formatConnectionString(baseServerAddress, ownerToken) : '';
  const exportedDeepLink =
    storedConfig && ownerToken ? formatDeepLink(baseServerAddress, ownerToken) : '';

  const handleCopyConnectionString = async (): Promise<void> => {
    if (!exportedConnectionString) return;
    await Clipboard.setStringAsync(exportedConnectionString);
    setCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  };
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  // Pre-fill from the stored config when it exists — into EMPTY fields
  // only (a reconnect after 断开 keeps the addresses, so the user never
  // re-types them). The address input gets the BASE (the two URLs are
  // recovered by stripping a trailing `/api` / `/sync`, which
  // `deriveSyncConfig` tolerates); the advanced inputs get the raw pair so
  // a deployment with a custom path layout survives a disconnect/reconnect
  // cycle unchanged. `storedConfig` re-reads on every poke, so this also
  // runs when the block flips back to disconnected.
  //
  // Skipped entirely once `addressIsAuthoritative` is set (see below): a
  // re-read must not resurrect the prefilled advanced pair behind the
  // user's back after they deliberately chose a different address.
  useEffect(() => {
    if (storedConfig === null) return;
    setServerAddress((prev) => (prev === '' ? stripDerivedSuffix(storedConfig.backendUrl) : prev));
    if (addressIsAuthoritative) return;
    setAdvancedBackendUrl((prev) => (prev === '' ? storedConfig.backendUrl : prev));
    setAdvancedEndpoint((prev) => (prev === '' ? storedConfig.endpoint : prev));
  }, [storedConfig, addressIsAuthoritative]);

  // Editing the server address is an EXPLICIT choice of server, so the
  // prefilled advanced pair must step aside — otherwise it silently wins
  // (`hasAdvanced` only asks "are both filled?") and the user's new
  // address is ignored with no visible sign: the OLD server is contacted
  // while the field shows the NEW one. Clearing both advanced fields is
  // the only honest reading of "I typed a different address"; a
  // deployment that genuinely needs the custom pair re-fills it (or pastes
  // a connection string) afterwards.
  const handleServerAddressChange = (next: string): void => {
    setAddressIsAuthoritative(true);
    setServerAddress(next);
    setAdvancedBackendUrl('');
    setAdvancedEndpoint('');
    clearError();
  };

  // An error handed over by the deep-link route becomes this screen's inline
  // error (the same three-state copy — the route and this screen share ONE
  // connect(), so the message is literally the same string).
  useEffect(() => {
    if (typeof syncError === 'string' && syncError !== '') {
      setError(syncError);
    }
  }, [syncError]);

  // Advanced values win whenever BOTH are filled; otherwise the single
  // server address drives the derivation. Exactly one branch is taken —
  // the two inputs can never both apply. A pasted CONNECTION STRING
  // carries its own address, so it satisfies the presence check on its
  // own: the user pasted a complete instruction and should not also have
  // to retype the address into the field above.
  const hasAdvanced = advancedBackendUrl.trim() !== '' && advancedEndpoint.trim() !== '';
  const connectionString = parseConnectionString(token);
  const addressPresent = hasAdvanced || connectionString !== null || serverAddress.trim() !== '';
  // The button only checks PRESENCE, not validity: address VALIDITY and
  // the token REQUIREMENT are both left to connect's inline error, not the
  // button (the pre-existing contract).
  const canSubmit = addressPresent && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // A pasted connection string carries BOTH halves (`<base>|<token>` or
      // `nextdo://sync?s=&t=`). When present it wins over whatever is in
      // the address field — the user pasted a complete, authoritative
      // instruction. A BARE token (parse → null) keeps the pre-existing
      // behavior of "this field is just the token".
      const result = connectionString
        ? await connect({
            serverAddress: connectionString.serverAddress,
            token: connectionString.token,
          })
        : hasAdvanced
          ? await connect({
              backendUrl: advancedBackendUrl,
              endpoint: advancedEndpoint,
              token,
            })
          : await connect({ serverAddress, token });
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-canvas dark:bg-canvas-dark"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header block (matches the other tabs) */}
        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          设置
        </Text>
        <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
          设备与云同步。
        </Text>

        {/* Appearance / Theme block */}
        <Card className="mt-4 gap-3 p-3.5">
          <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
            外观主题
          </Text>
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">
            选择跟随系统设置，或固定使用浅色 / 深色外观。
          </Text>
          <View className="flex-row gap-2">
            {THEME_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`主题：${option.label}`}
                accessibilityState={{ selected: preference === option.value }}
                onPress={() => void updatePreference(option.value)}
                className={cn(
                  'flex-1 items-center justify-center rounded-lg border py-2.5',
                  preference === option.value
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-xs font-semibold',
                    preference === option.value
                      ? 'text-accent dark:text-accent-dark'
                      : 'text-ink dark:text-ink-dark',
                  )}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Notifications block (task 09-30 R5 — the delivery status;
         *  above cloud sync: notifications are the execution core) */}
        <Card className="mt-4 gap-3 p-3.5">
          <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
            提醒通知
          </Text>
          {notificationPermission === null ? (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              检查中…
            </Text>
          ) : notificationPermission.platform === 'web' ? (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              浏览器环境不支持通知。
            </Text>
          ) : notificationPermission.platform === 'tauri' ? (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              桌面通知跟随系统设置（当前
              {notificationPermission.status === 'granted' ? '可用' : '不可用'}
              ）。应用关闭期间不会提醒。
            </Text>
          ) : notificationPermission.status === 'granted' ? (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              已授权 — 稍后与日历提醒会按时通知。
            </Text>
          ) : notificationPermission.status === 'denied' ? (
            <View className="gap-3">
              <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                通知已被拒绝 — 稍后与日历行动仍会记录，但不会在设定时刻提醒。
              </Text>
              {Platform.OS === 'ios' ? (
                <Button
                  label="去系统设置"
                  variant="secondary"
                  onPress={openSystemSettings}
                />
              ) : (
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  可在「系统设置 → 应用 → Nextdo → 通知」中重新允许。
                </Text>
              )}
            </View>
          ) : (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              尚未授权 — 首次「稍后」或创建限时日历行动时，会请求通知权限。
            </Text>
          )}
        </Card>

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
            {storedConfig !== null && ownerToken !== null ? (
              <View className="gap-2 pt-1">
                <View className="flex-row gap-2">
                  <Button
                    label={copied ? '已复制' : '复制连接串'}
                    variant="secondary"
                    onPress={() => {
                      void handleCopyConnectionString();
                    }}
                  />
                  <Button
                    label={showQrCode ? '收起二维码' : '扫码配对'}
                    variant="secondary"
                    onPress={() => {
                      setShowQrCode((prev) => !prev);
                    }}
                  />
                </View>
                {showQrCode && exportedDeepLink ? (
                  <View className="items-center gap-2 rounded-xl border border-border/80 bg-surface p-4 dark:border-border-dark dark:bg-surface-dark">
                    <QRCode value={exportedDeepLink} size={180} />
                    <Text className="text-center font-sans text-xs text-muted dark:text-muted-dark">
                      使用其他设备扫码，即可一键配对并连接此同步服务
                    </Text>
                  </View>
                ) : null}
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
              未连接 — 数据仅保存在这台设备上。粘贴来自其他设备或服务器的连接串，或填写你的同步服务器地址与 owner token 即可开启同步。
            </Text>
            <TextInput
              className={INPUT_CLASS}
              placeholder={TOKEN_PLACEHOLDER}
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
              accessibilityLabel={TOKEN_ACCESSIBILITY_LABEL}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="高级设置"
              accessibilityState={{ expanded: advancedOpen }}
              onPress={() => {
                setAdvancedOpen((prev) => !prev);
              }}
              className="flex-row items-center gap-1 py-1"
            >
              <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                {advancedOpen ? '收起高级设置' : '高级设置与手动输入'}
              </Text>
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                {advancedOpen ? '▴' : '▾'}
              </Text>
            </Pressable>
            {advancedOpen ? (
              <View className="gap-3 pt-1">
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  手动输入服务器基础地址（未粘贴完整连接串时使用）：
                </Text>
                <TextInput
                  className={INPUT_CLASS}
                  placeholder={SERVER_ADDRESS_PLACEHOLDER}
                  value={serverAddress}
                  onChangeText={handleServerAddressChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  accessibilityLabel="服务器地址"
                />
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  自定义反代路径时才需要：两项都填写时优先于上面的服务器地址。
                </Text>
                <TextInput
                  className={INPUT_CLASS}
                  placeholder={ADVANCED_BACKEND_PLACEHOLDER}
                  value={advancedBackendUrl}
                  onChangeText={(next) => {
                    setAdvancedBackendUrl(next);
                    clearError();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  accessibilityLabel="后端地址"
                />
                <TextInput
                  className={INPUT_CLASS}
                  placeholder={ADVANCED_ENDPOINT_PLACEHOLDER}
                  value={advancedEndpoint}
                  onChangeText={(next) => {
                    setAdvancedEndpoint(next);
                    clearError();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  accessibilityLabel="同步流地址"
                />
              </View>
            ) : null}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
