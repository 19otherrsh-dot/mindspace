import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { DailyActivity, MoodTrendPoint } from '@mindspace/shared';
import { spacing, radius } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Txt } from './ui';

/* ------------------------------------------------------------------ */
/* Progress ring (player)                                              */
/* ------------------------------------------------------------------ */

/** Circular time-remaining ring for the active player (screen 10). */
export function ProgressRing({
  progress,
  size = 260,
  strokeWidth = 6,
  track = 'rgba(255,255,255,0.18)',
  color = '#FFFFFF',
  children,
}: {
  /** 0–1. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  track?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  const radiusPx = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Rotated so the ring fills clockwise from 12 o'clock. */}
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radiusPx}
            stroke={track}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radiusPx}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped)}
          />
        </G>
      </Svg>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Weekly bars (stats)                                                 */
/* ------------------------------------------------------------------ */

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Minutes per day for the last week (screen 14). */
export function WeeklyBars({ data, height = 150 }: { data: DailyActivity[]; height?: number }) {
  const theme = useTheme();
  const max = Math.max(...data.map((d) => d.minutes), 1);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height }}>
      {data.map((day) => {
        // Give days with any activity a visible stub rather than nothing.
        const ratio = day.minutes / max;
        const barHeight = day.minutes === 0 ? 3 : Math.max(6, ratio * (height - 34));
        const weekday = new Date(`${day.date}T00:00:00`).getDay();

        return (
          <View key={day.date} style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
            <Txt variant="micro" tone="faint">
              {day.minutes > 0 ? day.minutes : ''}
            </Txt>
            <View
              accessibilityLabel={`${day.date}: ${day.minutes} minutes`}
              style={{
                width: '100%',
                height: barHeight,
                borderRadius: radius.sm,
                backgroundColor: day.minutes > 0 ? theme.colors.accent : theme.colors.surfaceMuted,
              }}
            />
            <Txt variant="micro" tone="faint">
              {WEEKDAY_INITIALS[weekday]}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Mood trend line (stats)                                             */
/* ------------------------------------------------------------------ */

/** Average mood over time, 1–5 (screen 14). */
export function MoodTrend({
  data,
  width,
  height = 140,
}: {
  data: MoodTrendPoint[];
  width: number;
  height?: number;
}) {
  const theme = useTheme();

  if (data.length === 0) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Txt variant="caption" tone="faint">
          Check in with your mood to see this chart
        </Txt>
      </View>
    );
  }

  const padding = { top: 12, right: 8, bottom: 20, left: 24 };
  const plotWidth = Math.max(width - padding.left - padding.right, 1);
  const plotHeight = height - padding.top - padding.bottom;

  // The scale is fixed to the mood range so the line's height is comparable
  // across periods rather than being rescaled to whatever this week contains.
  const yFor = (value: number) => padding.top + ((5 - value) / 4) * plotHeight;
  const xFor = (index: number) =>
    padding.left + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);

  const path = data
    .map((point, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(point.averageValue).toFixed(1)}`)
    .join(' ');

  return (
    <Svg width={width} height={height}>
      {[1, 3, 5].map((tick) => (
        <G key={tick}>
          <Line
            x1={padding.left}
            y1={yFor(tick)}
            x2={width - padding.right}
            y2={yFor(tick)}
            stroke={theme.colors.border}
            strokeWidth={1}
          />
          <SvgText x={0} y={yFor(tick) + 4} fill={theme.colors.textFaint} fontSize={10}>
            {tick}
          </SvgText>
        </G>
      ))}

      <Path d={path} stroke={theme.colors.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" />

      {data.map((point, i) => (
        <Circle
          key={point.date}
          cx={xFor(i)}
          cy={yFor(point.averageValue)}
          r={3.5}
          fill={theme.colors.accent}
        />
      ))}
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar heatmap (stats)                                            */
/* ------------------------------------------------------------------ */

/**
 * GitHub-style contribution grid over the last ~26 weeks (screen 14).
 * Columns are weeks, rows are weekdays.
 */
export function CalendarHeatmap({
  data,
  weeks = 26,
  cell = 12,
  gap = 3,
}: {
  data: DailyActivity[];
  weeks?: number;
  cell?: number;
  gap?: number;
}) {
  const theme = useTheme();

  const byDate = new Map(data.map((d) => [d.date, d.minutes]));
  const max = Math.max(...data.map((d) => d.minutes), 1);

  // Walk back to the Sunday that starts the earliest visible week.
  const today = new Date();
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const columns: Array<Array<{ date: string; minutes: number }>> = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const week: Array<{ date: string; minutes: number }> = [];
    for (let day = 0; day < 7; day += 1) {
      const iso = cursor.toISOString().slice(0, 10);
      week.push({ date: iso, minutes: byDate.get(iso) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    columns.push(week);
  }

  const width = columns.length * (cell + gap);
  const height = 7 * (cell + gap);

  return (
    <Svg width={width} height={height}>
      {columns.map((week, x) =>
        week.map((day, y) => {
          // Four visible steps; anything past the top intensity clamps.
          const intensity = day.minutes === 0 ? 0 : Math.min(1, 0.25 + (day.minutes / max) * 0.75);
          const future = new Date(`${day.date}T00:00:00Z`) > end;

          return (
            <Rect
              key={day.date}
              x={x * (cell + gap)}
              y={y * (cell + gap)}
              width={cell}
              height={cell}
              rx={2.5}
              fill={
                future
                  ? 'transparent'
                  : intensity === 0
                    ? theme.colors.surfaceMuted
                    : theme.colors.accent
              }
              opacity={intensity === 0 ? 1 : intensity}
            />
          );
        }),
      )}
    </Svg>
  );
}
