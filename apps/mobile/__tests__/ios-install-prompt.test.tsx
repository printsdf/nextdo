import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { IosInstallPrompt } from '../components/ios-install-prompt';

describe('IosInstallPrompt component', () => {
  const originalNavigator = global.navigator;
  let originalOS: string;
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    jest.useFakeTimers();
    originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    mockStorage = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => mockStorage[key] ?? null,
        setItem: (key: string, val: string) => {
          mockStorage[key] = String(val);
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('renders nothing on non-iOS user agents', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        maxTouchPoints: 0,
      },
      configurable: true,
      writable: true,
    });

    render(<IosInstallPrompt />);
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByText(/添加到 iPhone 主屏幕/)).toBeNull();
  });

  it('renders install prompt on iOS Safari and dismisses when user taps close', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
        standalone: false,
      },
      configurable: true,
      writable: true,
    });

    render(<IosInstallPrompt />);
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText(/添加到 iPhone 主屏幕/)).toBeTruthy();
    expect(screen.getByText(/分享/)).toBeTruthy();
    expect(screen.getAllByText(/添加到主屏幕/).length).toBeGreaterThan(0);

    const dismissBtn = screen.getByRole('button', { name: '我知道了' });
    act(() => {
      fireEvent.press(dismissBtn);
    });

    expect(screen.queryByText(/添加到 iPhone 主屏幕/)).toBeNull();
    expect(mockStorage['nextdo_ios_pwa_dismissed']).toBeDefined();
  });

  it('does not render when running inside iOS standalone PWA mode', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        maxTouchPoints: 5,
        standalone: true, // already added to home screen
      },
      configurable: true,
      writable: true,
    });

    render(<IosInstallPrompt />);
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByText(/添加到 iPhone 主屏幕/)).toBeNull();
  });
});
