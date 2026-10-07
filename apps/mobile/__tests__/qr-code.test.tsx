import { render } from '@testing-library/react-native';
import { QRCode } from '../components/qr-code';

describe('QRCode component', () => {
  it('renders accessibility role and label for a valid value', () => {
    const { getByLabelText } = render(
      <QRCode value="nextdo://sync?s=https%3A%2F%2Fexample.com&t=tok123" />,
    );
    const element = getByLabelText('配对二维码');
    expect(element).toBeTruthy();
  });

  it('renders null when value is empty or whitespace', () => {
    const { queryByLabelText } = render(<QRCode value="   " />);
    expect(queryByLabelText('配对二维码')).toBeNull();
  });

  it('accepts custom size and accessibility label', () => {
    const { getByLabelText } = render(
      <QRCode
        value="https://example.com|tok"
        size={150}
        accessibilityLabel="测试二维码"
      />,
    );
    const element = getByLabelText('测试二维码');
    expect(element.props.style).toEqual(
      expect.objectContaining({ width: 150, height: 150 }),
    );
  });
});
