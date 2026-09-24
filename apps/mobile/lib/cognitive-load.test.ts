/**
 * Unit tests — the Now-screen cognitive-load bands (lib/cognitive-load).
 * Pure function: no clock, no DB.
 */
import { cognitiveLoadLabel } from './cognitive-load';

describe('cognitiveLoadLabel (<60 轻 / 60–180 平 / >180 重)', () => {
  it.each([
    [0, '轻'],
    [59, '轻'],
    [60, '平'],
    [180, '平'],
    [181, '重'],
    [1000, '重'],
  ])('maps %i total minutes to %s', (minutes, label) => {
    expect(cognitiveLoadLabel(minutes)).toBe(label);
  });
});
