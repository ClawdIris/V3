import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme, type Theme } from './tokens';

/**
 * The app follows the system appearance. There is no in-app theme switch:
 * iOS already has one, and a second source of truth is a bug generator.
 */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}
