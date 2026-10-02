import { useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';

/**
 * A minimal horizontal slider. The community slider package pulls in a native
 * module for what is, here, one control on one screen — this keeps the
 * dependency list short and behaves identically on web.
 */
export function Slider({
  value,
  onChange,
  minimumTrackColor,
  maximumTrackColor,
  thumbColor = '#FFFFFF',
  height = 36,
  accessibilityLabel,
}: {
  /** 0–1. */
  value: number;
  onChange: (value: number) => void;
  minimumTrackColor: string;
  maximumTrackColor: string;
  thumbColor?: string;
  height?: number;
  accessibilityLabel: string;
}) {
  const [width, setWidth] = useState(0);

  // Refs because the PanResponder is created once and would otherwise close
  // over the first render's width and callback.
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        if (widthRef.current > 0) {
          onChangeRef.current(clamp(event.nativeEvent.locationX / widthRef.current));
        }
      },
      onPanResponderMove: (event) => {
        if (widthRef.current > 0) {
          onChangeRef.current(clamp(event.nativeEvent.locationX / widthRef.current));
        }
      },
    }),
  ).current;

  const handleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    widthRef.current = next;
    setWidth(next);
  };

  const clamped = clamp(value);

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      onLayout={handleLayout}
      style={{ height, justifyContent: 'center' }}
      {...responder.panHandlers}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: maximumTrackColor }}>
        <View
          style={{
            height: '100%',
            width: `${clamped * 100}%`,
            borderRadius: 2,
            backgroundColor: minimumTrackColor,
          }}
        />
      </View>

      {width > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: Math.max(0, Math.min(width - 16, clamped * width - 8)),
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: thumbColor,
          }}
        />
      ) : null}
    </View>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
