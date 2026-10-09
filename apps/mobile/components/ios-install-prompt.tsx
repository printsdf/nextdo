import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

const STORAGE_KEY = 'nextdo_ios_pwa_dismissed';
const DISMISS_DAYS = 7;

interface WebHostWindow {
  navigator?: {
    userAgent?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
  };
  matchMedia?: (query: string) => { matches: boolean };
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
}

function getWebWindow(): WebHostWindow | undefined {
  return typeof globalThis !== 'undefined'
    ? (globalThis as unknown as { window?: WebHostWindow }).window
    : undefined;
}

function isIosSafari(): boolean {
  if (Platform.OS !== 'web') return false;

  const win = getWebWindow();
  if (!win?.navigator?.userAgent) return false;

  const ua = win.navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ desktop-class Safari detection
    (ua.includes('Macintosh') && (win.navigator.maxTouchPoints ?? 0) > 1);

  // If running in standalone mode (already installed), do not prompt
  const isStandalone =
    win.navigator.standalone === true ||
    win.matchMedia?.('(display-mode: standalone)').matches === true;

  return isIos && !isStandalone;
}

export function IosInstallPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isIosSafari()) return;

    const win = getWebWindow();
    try {
      const dismissedAt = win?.localStorage?.getItem(STORAGE_KEY);
      if (dismissedAt) {
        const diffDays = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
        if (diffDays < DISMISS_DAYS) {
          return;
        }
      }
    } catch {
      // localStorage disabled or private mode, ignore
    }

    // Delay 1.5s to not block first paint
    const timer = setTimeout(() => {
      setVisible(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    const win = getWebWindow();
    try {
      win?.localStorage?.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  if (!visible) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel="添加到主屏幕安装提示"
      className="absolute bottom-20 left-4 right-4 z-50 rounded-2xl border border-accent/30 bg-surface/95 p-4 shadow-xl backdrop-blur-md dark:border-accent-dark/30 dark:bg-surface-dark/95"
      style={{
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
      }}
    >
      <View className="flex-row items-center justify-between pb-2">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-bold text-ink dark:text-ink-dark font-display">
            📲 添加到 iPhone 主屏幕
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭安装提示"
          onPress={handleDismiss}
          className="rounded-full p-1 active:opacity-60"
        >
          <Text className="text-sm font-semibold text-muted dark:text-muted-dark">✕</Text>
        </Pressable>
      </View>

      <Text className="text-xs text-muted dark:text-muted-dark leading-relaxed">
        无需 App Store，将 Nextdo 添加到主屏幕即可像原生应用一样全屏沉浸使用、离线存取并接收任务提醒：
      </Text>

      <View className="my-2.5 gap-2 rounded-xl bg-canvas/80 p-2.5 dark:bg-canvas-dark/80">
        <View className="flex-row items-center gap-2">
          <Text className="text-base text-accent dark:text-accent-dark font-semibold">1.</Text>
          <Text className="text-xs text-ink dark:text-ink-dark">
            点击 Safari 底部工具栏的 <Text className="font-bold">「分享」</Text> 按钮（带有箭头的图标 ⎋）
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-base text-accent dark:text-accent-dark font-semibold">2.</Text>
          <Text className="text-xs text-ink dark:text-ink-dark">
            在菜单中向下滑动，选择 <Text className="font-bold">「添加到主屏幕」</Text>（带有 ⊞ 标志）
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between pt-1">
        <Text className="text-[11px] text-muted/80 dark:text-muted-dark/80">
          💡 安装后享受丝滑离线秒开体验
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="我知道了"
          onPress={handleDismiss}
          className="rounded-lg bg-accent px-3 py-1.5 active:opacity-80 dark:bg-accent-dark"
        >
          <Text className="text-xs font-semibold text-white">我知道了</Text>
        </Pressable>
      </View>
    </View>
  );
}
