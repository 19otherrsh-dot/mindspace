import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, type Theme } from './index';
import { useAuthStore } from '@/store/auth';

/**
 * Resolves the active theme from the user's saved preference, falling back to
 * the OS setting when they have chosen "system" (or are not signed in yet).
 */
export function useTheme(): Theme {
  const system = useColorScheme();
  const preference = useAuthStore((s) => s.user?.preferences.theme ?? 'system');

  if (preference === 'dark') return darkTheme;
  if (preference === 'light') return lightTheme;
  return system === 'light' ? lightTheme : darkTheme;
}
