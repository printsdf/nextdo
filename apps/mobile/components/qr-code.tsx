/**
 * Pure React Native QR Code component.
 *
 * Generates the QR matrix via `qrcode`'s core pure-JS algorithm and renders
 * using row-merged React Native `<View>` elements. This requires NO canvas,
 * NO DOM, NO react-native-svg, and NO native binary modules, working
 * identically across iOS, Android, Web (Tauri desktop), and Jest tests.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import QRCodeCore from 'qrcode';
import { cn } from '@nextdo/ui';

export interface QRCodeProps {
  /** The payload encoded in the QR code (e.g. nextdo://sync?s=...&t=...). */
  value: string;
  /** Width and height in points. Defaults to 200. */
  size?: number;
  /** Foreground module color. Defaults to '#000000'. */
  color?: string;
  /** Background color. Defaults to '#ffffff'. */
  backgroundColor?: string;
  /** Optional NativeWind className for the outer container. */
  className?: string;
  /** Accessibility label for screen readers. Defaults to '配对二维码'. */
  accessibilityLabel?: string;
}

interface Segment {
  row: number;
  col: number;
  length: number;
}

export function QRCode({
  value,
  size = 200,
  color = '#000000',
  backgroundColor = '#ffffff',
  className,
  accessibilityLabel = '配对二维码',
}: QRCodeProps) {
  const { segments, cellSize } = useMemo(() => {
    if (!value || value.trim() === '') {
      return { segments: [], cellSize: 0 };
    }
    try {
      const qr = QRCodeCore.create(value, { errorCorrectionLevel: 'M' });
      const count = qr.modules.size;
      const computedCellSize = size / count;
      const segs: Segment[] = [];

      for (let r = 0; r < count; r++) {
        let c = 0;
        while (c < count) {
          if (qr.modules.get(r, c)) {
            const start = c;
            while (c + 1 < count && qr.modules.get(r, c + 1)) {
              c++;
            }
            segs.push({ row: r, col: start, length: c - start + 1 });
          }
          c++;
        }
      }

      return { segments: segs, cellSize: computedCellSize };
    } catch {
      return { segments: [], cellSize: 0 };
    }
  }, [value, size]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      className={cn('relative overflow-hidden rounded-lg p-2', className)}
      style={{
        width: size,
        height: size,
        backgroundColor,
      }}
    >
      {segments.map((seg, idx) => (
        <View
          key={idx}
          style={{
            position: 'absolute',
            top: seg.row * cellSize,
            left: seg.col * cellSize,
            width: seg.length * cellSize,
            height: cellSize,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}
