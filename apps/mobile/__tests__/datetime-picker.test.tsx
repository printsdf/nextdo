import { fireEvent, render, screen } from '@testing-library/react-native';
import { DateTimePicker } from '../components/datetime-picker';

describe('DateTimePicker', () => {
  const now = new Date(2026, 8, 25, 14, 30); // 2026-09-25 14:30
  const onConfirm = jest.fn();
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders time mode with hour and minute lists and allows selection', () => {
    render(
      <DateTimePicker
        mode="time"
        title="指定时间"
        value="14:30"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getAllByText('指定时间').length).toBeGreaterThan(0);
    expect(screen.getByText('14:30')).toBeTruthy();
    expect(screen.getByLabelText('小时 14')).toBeTruthy();
    expect(screen.getByLabelText('分钟 30')).toBeTruthy();

    // Fast preset minutes
    fireEvent.press(screen.getByLabelText('快捷 15分'));
    expect(screen.getByText('14:15')).toBeTruthy();

    // Select hour 09
    fireEvent.press(screen.getByLabelText('小时 09'));
    expect(screen.getByText('09:15')).toBeTruthy();

    // Confirm
    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('09:15');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders datetime mode and allows changing day offset and scrolling hours', () => {
    render(
      <DateTimePicker
        mode="datetime"
        title="选择时间"
        value="2026-09-25T14:30"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getAllByText('今天').length).toBeGreaterThan(0);
    expect(screen.getByText('明天')).toBeTruthy();

    // Click "明天"
    fireEvent.press(screen.getByLabelText('日 明天'));

    // Select hour 09
    fireEvent.press(screen.getByLabelText('小时 09'));
    expect(screen.getByText('09:30')).toBeTruthy();

    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26T09:30');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders date mode and allows picking year, month and day', () => {
    render(
      <DateTimePicker
        mode="date"
        title="选择日期"
        value="2026-09-25"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('2026年09月25日')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('日 28'));
    expect(screen.getByText('2026年09月28日')).toBeTruthy();

    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-28');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
