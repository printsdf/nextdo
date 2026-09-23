/**
 * Unit tests — the NextdoError code → Chinese copy table (lib/error-messages).
 */
import { ValidationNextdoError } from '@nextdo/core';
import { errorMessage } from './error-messages';

describe('errorMessage', () => {
  it('maps known codes to Chinese copy', () => {
    expect(errorMessage(new ValidationNextdoError('project.needs-outcome', 'A project requires an outcome'))).toBe(
      '项目必须有明确结果（"完成"是什么样）',
    );
    expect(errorMessage(new ValidationNextdoError('action.not-found', 'No live next action with id x'))).toBe(
      '这个行动不存在了（可能已被删除）',
    );
    expect(
      errorMessage(new ValidationNextdoError('validation.calendarAction.startsAt', 'calendarAction.startsAt is invalid')),
    ).toBe('请选择开始时间');
  });

  it('maps dynamic invalid-transition codes via prefix', () => {
    expect(errorMessage(new ValidationNextdoError('invalid-transition:done:active', 'Illegal transition'))).toBe(
      '这个状态变更不被允许',
    );
  });

  it('falls back to the typed message for unmapped codes', () => {
    const err = new ValidationNextdoError('some.future.code', 'specific detail');
    expect(errorMessage(err)).toBe('specific detail');
  });

  it('handles plain Errors and non-Error values', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('raw string')).toBe('raw string');
    expect(errorMessage(null)).toBe('null');
  });
});
