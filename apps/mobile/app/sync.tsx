/**
 * Connection-string deep-link route (10-02-simplify-sync-setup, design D6).
 *
 * `nextdo://sync?s=<base address>&t=<owner token>` — the shape a QR code or
 * a shared link delivers on a phone. This is a THIN route on purpose: it
 * reads the two parameters and calls the SAME `useCloudSync().connect()` the
 * Settings tab calls. A second connection path would mean a second set of
 * validation rules and a second set of error copy — the two would drift.
 *
 * Outcome:
 *   success → `router.replace('/(tabs)/now')` — the app is usable and the
 *            Now tab is the natural landing surface. replace (not push) so
 *            Back does not return to a stale, already-consumed link.
 *   failure → the Settings tab with the error passed along in the query
 *            (`?syncError=…`), so the user SEES why instead of a silent
 *            no-op; the settings screen renders it as its inline error and
 *            keeps the pasted values in its fields.
 *
 * Desktop (Tauri) registers no system protocol, so deep links are a mobile
 * affordance; desktop users paste the plaintext `<base>|<token>` form into
 * the Settings tab (the same parser, `parseConnectionString`).
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCloudSync } from '@/hooks/use-cloud-sync';
import { parseConnectionString } from '@/lib/sync-connection';

/** The transient status shown while the single connect attempt runs. */
type Phase = 'connecting' | 'done';

export default function SyncLinkScreen() {
  const params = useLocalSearchParams<{ s?: string; t?: string }>();
  const { connect } = useCloudSync();
  const [phase, setPhase] = useState<Phase>('connecting');
  // A ref, not state: the effect must fire ONCE PER LINK even though
  // `connect` is a new function identity on every render (useCallback with
  // [] deps keeps it stable, but the ref is the explicit, review-proof
  // guard against a double submit — a second /credentials round-trip on
  // a shared secret is not something to leave to a dependency array).
  //
  // It stores the LINK KEY that was handled, not a bare boolean. A
  // boolean latch would also freeze the route after the FIRST link: a
  // user who taps a second connection link (a corrected QR, a new server)
  // while the app is already open would get a screen that does nothing at
  // all — the deepest kind of silent failure. Keying on the params means
  // each distinct link is honored exactly once, and a re-render with the
  // same params still does not re-post the token.
  const handled = useRef<string | null>(null);

  // The query params can arrive as string | string[] (expo-router types);
  // only a single scalar value is a usable link.
  const rawServerAddress = typeof params.s === 'string' ? params.s : '';
  const rawToken = typeof params.t === 'string' ? params.t : '';

  const safeDecode = (val: string): string => {
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  };

  let serverAddress = safeDecode(rawServerAddress).trim();
  let token = safeDecode(rawToken).trim();

  // If a full connection string `<base>|<token>` was passed into `s`, parse it
  if ((serverAddress.includes('|') || serverAddress.includes('｜')) && token === '') {
    const parsed = parseConnectionString(serverAddress);
    if (parsed) {
      serverAddress = parsed.serverAddress;
      token = parsed.token;
    }
  }

  // The identity of the link this render is about. Always a string —
  // including for an INCOMPLETE link — so a half-filled link is handled
  // (and reported) exactly once instead of silently spinning forever.
  const linkKey = `${serverAddress}\u0000${token}`;

  useEffect(() => {
    if (handled.current === linkKey) return; // this exact link already ran
    handled.current = linkKey;
    // Malformed link (missing half) — there is nothing to connect with;
    // the Settings tab explains what is needed instead of failing
    // silently. Still keyed, so re-opening the SAME malformed link does
    // not re-navigate, while a DIFFERENT one does.
    if (serverAddress.trim() === '' || token.trim() === '') {
      setPhase('done');
      router.replace({
        pathname: '/(tabs)/settings',
        params: { syncError: '连接串不完整，请在设置页重新填写' },
      });
      return;
    }
    void (async () => {
      const result = await connect({ serverAddress, token });
      setPhase('done');
      if (result.ok) {
        router.replace('/(tabs)/now');
      } else {
        router.replace({
          pathname: '/(tabs)/settings',
          params: { syncError: result.message },
        });
      }
    })();
    // Keyed on the link identity: re-running on `serverAddress` /
    // `token` directly would be equivalent, but naming the pair makes
    // the "exactly once per link" contract explicit at the call site.
  }, [linkKey]);

  return (
    <View className="flex-1 items-center justify-center bg-canvas px-6 dark:bg-canvas-dark">
      {phase === 'connecting' ? (
        <Text className="font-sans text-sm text-muted dark:text-muted-dark">
          正在连接同步服务器…
        </Text>
      ) : (
        <Text className="font-sans text-sm text-muted dark:text-muted-dark">
          正在打开设置…
        </Text>
      )}
    </View>
  );
}