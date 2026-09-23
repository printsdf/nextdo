/**
 * Unit tests — the pure focus-timer math (lib/focus-timer).
 */
import { elapsedSeconds, formatClock, isTimeUp, remainingSeconds } from './focus-timer';

const START = new Date('2026-09-22T10:00:00.000Z');
const at = (seconds: number): Date => new Date(START.getTime() + seconds * 1000);

describe('elapsedSeconds', () => {
  it('counts wall time since the start', () => {
    expect(elapsedSeconds(START, 0, at(120))).toBe(120);
  });

  it('subtracts the ABSOLUTE accumulated pause', () => {
    // 10 minutes elapsed, 90s paused → 510s worked.
    expect(elapsedSeconds(START, 90, at(600))).toBe(510);
  });

  it('never goes negative (clock skew / pause longer than wall time)', () => {
    expect(elapsedSeconds(START, 5000, at(10))).toBe(0);
  });
});

describe('remainingSeconds (preset sessions)', () => {
  it('counts down a 25-minute preset', () => {
    expect(remainingSeconds(START, 25, 0, at(0))).toBe(1500);
    expect(remainingSeconds(START, 25, 0, at(600))).toBe(900);
  });

  it('pause stops the countdown (absolute pausedSec)', () => {
    // 10 min wall, 90s paused on a 25-min preset → 1500 - 510 = 990 left.
    expect(remainingSeconds(START, 25, 90, at(600))).toBe(990);
  });

  it('goes negative past the target (the banner clamps the display)', () => {
    expect(remainingSeconds(START, 25, 0, at(1600))).toBe(-100);
  });
});

describe('free timer (plannedMinutes = null)', () => {
  it('has no remaining target but counts up', () => {
    expect(remainingSeconds(START, null, 0, at(300))).toBeNull();
    expect(isTimeUp(START, null, 0, at(999999))).toBe(false);
    expect(elapsedSeconds(START, 0, at(300))).toBe(300);
    // Pauses apply to the free count-up too.
    expect(elapsedSeconds(START, 120, at(300))).toBe(180);
  });
});

describe('isTimeUp', () => {
  it('fires exactly at the target', () => {
    expect(isTimeUp(START, 25, 0, at(1499))).toBe(false);
    expect(isTimeUp(START, 25, 0, at(1500))).toBe(true);
    expect(isTimeUp(START, 25, 0, at(1501))).toBe(true);
  });

  it('a long pause cannot trip the timer early', () => {
    // 1600s wall but 200s paused → only 1400s worked → not up yet.
    expect(isTimeUp(START, 25, 200, at(1600))).toBe(false);
  });
});

describe('formatClock', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(59)).toBe('00:59');
    expect(formatClock(60)).toBe('01:00');
    expect(formatClock(1500)).toBe('25:00');
    expect(formatClock(3661)).toBe('1:01:01');
  });

  it('clamps negative values at 00:00 (preset past its target)', () => {
    expect(formatClock(-100)).toBe('00:00');
  });
});
