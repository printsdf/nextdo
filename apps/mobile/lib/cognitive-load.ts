/**
 * The Now-screen cognitive-load label (design §5): the total estimated
 * minutes of the eligible pool, banded into the PRD's three levels —
 * <60 轻 / 60–180 (inclusive) 平 / >180 重 (the design mock's "平稳"
 * semantics). Pure and total: no DB, no clock.
 */
export function cognitiveLoadLabel(totalMinutes: number): '轻' | '平' | '重' {
  if (totalMinutes < 60) return '轻';
  if (totalMinutes <= 180) return '平';
  return '重';
}
