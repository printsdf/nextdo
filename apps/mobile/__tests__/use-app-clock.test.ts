import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import { useAppClock } from '../hooks/use-app-clock';

interface TestHost {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  document?: {
    visibilityState?: string;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
}

describe('useAppClock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns current date and updates on 1-minute interval', () => {
    const t0 = new Date('2026-10-09T10:00:00.000Z');
    jest.setSystemTime(t0);

    const { result } = renderHook(() => useAppClock());
    expect(result.current.toISOString()).toBe(t0.toISOString());

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    const t1 = new Date('2026-10-09T10:01:00.000Z');
    expect(result.current.toISOString()).toBe(t1.toISOString());
  });

  it('updates immediately when native AppState transitions to active', () => {
    let appStateListener: ((state: string) => void) | null = null;
    const addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener as (state: string) => void;
        return {
          remove: jest.fn(),
        } as unknown as ReturnType<typeof AppState.addEventListener>;
      });

    const t0 = new Date('2026-10-09T10:00:00.000Z');
    jest.setSystemTime(t0);

    const { result } = renderHook(() => useAppClock());
    expect(result.current.toISOString()).toBe(t0.toISOString());

    // Advance real clock by 25 minutes while backgrounded
    const t25 = new Date('2026-10-09T10:25:00.000Z');
    jest.setSystemTime(t25);

    // Foreground wake up event
    expect(appStateListener).toBeDefined();
    act(() => {
      appStateListener?.('active');
    });

    expect(result.current.toISOString()).toBe(t25.toISOString());
    addEventListenerSpy.mockRestore();
  });

  it('updates immediately on web focus and visibility change', () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    const host = globalThis as unknown as TestHost;
    const focusListeners: (() => void)[] = [];
    const visibilityListeners: (() => void)[] = [];

    const originalAddEventListener = host.addEventListener;
    const originalDoc = host.document;

    host.addEventListener = jest.fn((type: string, listener: () => void) => {
      if (type === 'focus') {
        focusListeners.push(listener);
      }
    });

    const mockDoc: NonNullable<TestHost['document']> = {
      visibilityState: 'visible',
      addEventListener: jest.fn((type: string, listener: () => void) => {
        if (type === 'visibilitychange') {
          visibilityListeners.push(listener);
        }
      }),
      removeEventListener: jest.fn(),
    };
    host.document = mockDoc;

    try {
      const t0 = new Date('2026-10-09T12:00:00.000Z');
      jest.setSystemTime(t0);

      const { result } = renderHook(() => useAppClock());
      expect(result.current.toISOString()).toBe(t0.toISOString());

      // Advance clock 10 minutes without timer tick
      const t10 = new Date('2026-10-09T12:10:00.000Z');
      jest.setSystemTime(t10);

      act(() => {
        focusListeners.forEach((fn) => fn());
      });
      expect(result.current.toISOString()).toBe(t10.toISOString());

      // Advance clock another 10 minutes
      const t20 = new Date('2026-10-09T12:20:00.000Z');
      jest.setSystemTime(t20);

      act(() => {
        visibilityListeners.forEach((fn) => fn());
      });
      expect(result.current.toISOString()).toBe(t20.toISOString());
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalPlatform, configurable: true });
      host.addEventListener = originalAddEventListener;
      host.document = originalDoc;
    }
  });
});
