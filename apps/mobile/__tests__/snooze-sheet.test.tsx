/**
 * Component tests — the snooze choice sheet (components/snooze-sheet):
 * the ONE common shortcut (10 分钟后) + the 自定义时间 flow through the
 * DateTimePicker 'datetime' mode (日/时/分 chips). `now` is injected as a
 * fixed Date — every expected target is device-local.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SnoozeSheet } from '@/components/snooze-sheet';

const NOW = new Date(2026, 8, 22, 10, 0, 0); // local Mon 2026-09-22 10:00

function renderSheet(onSelect: jest.Mock = jest.fn(), onClose: jest.Mock = jest.fn()) {
  render(<SnoozeSheet open={true} now={NOW} onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose };
}

describe('SnoozeSheet', () => {
  it('shows exactly one common option (10 分钟后) + the custom row', () => {
    renderSheet();
    expect(screen.getByText('稍后提醒')).toBeTruthy();
    expect(screen.getByText('10 分钟后')).toBeTruthy();
    expect(screen.getByText('自定义时间')).toBeTruthy();
    // The old four-option presets are gone.
    expect(screen.queryByText('30 分钟后')).toBeNull();
    expect(screen.queryByText(/今晚 20:00/)).toBeNull();
    expect(screen.queryByText(/明晚 20:00/)).toBeNull();
    expect(screen.queryByText(/明天 08:00/)).toBeNull();
  });

  it('the common shortcut snoozes to now + 10m and closes', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('10 分钟后'));
    expect(onSelect).toHaveBeenCalledWith(new Date(NOW.getTime() + 10 * 60_000));
    expect(onClose).toHaveBeenCalled();
  });

  it('自定义时间: 明天 14:30 through the day/hour/minute chips', () => {
    const { onSelect } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));

    // The picker opened (seeded at now + 1h = 今天 11:00).
    expect(screen.getByText('自定义提醒时间')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '日 明天' }));
    fireEvent.press(screen.getByRole('button', { name: '小时 14' }));
    fireEvent.press(screen.getByRole('button', { name: '分钟 30' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 8, 23, 14, 30, 0));
  });

  it('the 时/分 chip grids pick any hour and minute (23:59)', () => {
    const { onSelect } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));

    // Day stays the seeded 今天; jump straight to 23:59 via the chips.
    fireEvent.press(screen.getByRole('button', { name: '小时 23' }));
    fireEvent.press(screen.getByRole('button', { name: '分钟 59' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 8, 22, 23, 59, 0));
  });

  it('a past custom time is rejected with an inline message (no snooze)', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));

    // Seed is 今天 11:00 — pick an already-past hour (now = 10:00).
    fireEvent.press(screen.getByRole('button', { name: '小时 09' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('所选时间已过，请选晚于现在的时间')).toBeTruthy();
  });

  it('after a rejected past time, the next valid pick snoozes (error clears)', () => {
    const { onSelect } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));
    fireEvent.press(screen.getByRole('button', { name: '小时 09' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));
    expect(screen.getByText('所选时间已过，请选晚于现在的时间')).toBeTruthy();

    // Reopen: the error is gone, and the seed (今天 11:00) is valid as-is.
    fireEvent.press(screen.getByText('自定义时间'));
    expect(screen.queryByText('所选时间已过，请选晚于现在的时间')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: '确定' }));
    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 8, 22, 11, 0, 0));
  });

  it('the picker 取消 keeps the sheet open without snoozing', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));
    // Two 取消 buttons now (sheet + picker) — press the picker's.
    const cancels = screen.getAllByRole('button', { name: '取消' });
    fireEvent.press(cancels.at(-1)!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('自定义时间')).toBeTruthy();
  });

  it('the sheet 取消 closes without snoozing', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByRole('button', { name: '取消' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
