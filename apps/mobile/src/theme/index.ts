import { Platform } from 'react-native';
import type { Category } from '@mindspace/shared';

/**
 * Mindspace's visual language: deep navy grounds, soft gradients, generous
 * spacing. The PRD asks for a "distraction-free environment", so the palette
 * stays low-contrast and quiet except where it needs to guide an action.
 */

const palette = {
  navy900: '#0B1026',
  navy800: '#131A35',
  navy700: '#1C2445',
  navy600: '#273056',
  navy500: '#39426B',

  cloud50: '#F7F8FC',
  cloud100: '#EFF1F8',
  cloud200: '#E1E5F0',
  cloud300: '#C6CCDE',
  cloud400: '#9AA2BC',

  periwinkle: '#5B7FFF',
  periwinkleSoft: '#8AA4FF',
  lavender: '#8E7CFF',
  apricot: '#F2A65A',
  rose: '#E86A92',
  mint: '#4FD1A5',
  amber: '#FFC658',
} as const;

export interface Theme {
  dark: boolean;
  colors: {
    background: string;
    backgroundElevated: string;
    surface: string;
    surfaceMuted: string;
    border: string;
    text: string;
    textMuted: string;
    textFaint: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    success: string;
    warning: string;
    danger: string;
    streak: string;
    /** Two-stop gradient used behind hero areas and the player. */
    heroGradient: readonly [string, string];
    scrim: string;
  };
}

export const darkTheme: Theme = {
  dark: true,
  colors: {
    background: palette.navy900,
    backgroundElevated: palette.navy800,
    surface: palette.navy700,
    surfaceMuted: palette.navy600,
    border: palette.navy500,
    text: palette.cloud50,
    textMuted: palette.cloud300,
    textFaint: palette.cloud400,
    accent: palette.periwinkle,
    accentSoft: palette.periwinkleSoft,
    onAccent: '#FFFFFF',
    success: palette.mint,
    warning: palette.amber,
    danger: palette.rose,
    streak: palette.apricot,
    heroGradient: [palette.navy800, palette.navy900],
    scrim: 'rgba(6, 9, 22, 0.72)',
  },
};

export const lightTheme: Theme = {
  dark: false,
  colors: {
    background: palette.cloud50,
    backgroundElevated: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: palette.cloud100,
    border: palette.cloud200,
    text: palette.navy900,
    textMuted: '#5A6280',
    textFaint: '#8189A3',
    accent: palette.periwinkle,
    accentSoft: palette.lavender,
    onAccent: '#FFFFFF',
    success: '#25A87E',
    warning: '#D9932B',
    danger: '#D4507A',
    streak: '#E08B39',
    heroGradient: ['#FFFFFF', palette.cloud100],
    scrim: 'rgba(11, 16, 38, 0.45)',
  },
};

/** 4pt scale — every margin and padding in the app comes from here. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  subheading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '500' },
  micro: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
} as const;

/** Per-category accent, used for artwork placeholders and category chips. */
export const categoryColors: Record<Category, readonly [string, string]> = {
  stress: ['#6C63FF', '#4A43C4'],
  anxiety: ['#4FA3D1', '#2F6E92'],
  sleep: ['#3B3F8F', '#1E2154'],
  focus: ['#E8833A', '#B85F1F'],
  relationships: ['#D65DB1', '#9C3A80'],
  sports: ['#2FA84F', '#1C7235'],
  beginners: ['#5B7FFF', '#3457C9'],
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 6 },
  default: {},
}) as object;
