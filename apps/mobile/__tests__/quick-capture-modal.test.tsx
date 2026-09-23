import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QuickCaptureModal } from '@/components/quick-capture-modal';

describe('QuickCaptureModal', () => {
  it('renders title and inputs when visible', () => {
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={jest.fn()}
      />,
    );

    expect(screen.getByText('有什么想记下的？')).toBeTruthy();
    expect(screen.getByPlaceholderText(/记下任何事/)).toBeTruthy();
  });

  it('submits captured text and resets input on submit', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={onAdd}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '买牛奶和咖啡豆');
    fireEvent.press(screen.getByText('记录'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('买牛奶和咖啡豆');
    });

    // Successfully saved badge appears
    await waitFor(() => {
      expect(screen.getByText('已记下 1 条')).toBeTruthy();
    });
  });

  it('calls onClose when backdrop or cancel button is pressed', () => {
    const onClose = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={onClose}
        onAdd={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByText('稍后再说'));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits on Enter key press', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={onAdd}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '键盘回车录入');
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Enter' } });

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('键盘回车录入');
    });
  });

  it('dismisses modal on Escape key press', () => {
    const onClose = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={onClose}
        onAdd={jest.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Escape' } });

    expect(onClose).toHaveBeenCalled();
  });
});
