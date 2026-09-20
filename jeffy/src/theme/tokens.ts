/**
 * Design tokens.
 *
 * Jeffy is a photo app: the clothes are the interface. So the chrome is close
 * to monochrome and the type scale is small, letting garment colour be the
 * only colour on screen. Every token has a light and a dark value; nothing in
 * the app hardcodes a hex.
 */

export const palette = {
  ink: '#0E0E10',
  inkSoft: '#1A1A1E',
  slate: '#6B6B74',
  mist: '#A8A8B0',
  line: '#E4E4E8',
  lineDark: '#2A2A30',
  paper: '#FFFFFF',
  paperSoft: '#F7F7F8',
  accent: '#3A5BD9',
  accentDark: '#7A93F0',
  success: '#1F7A4D',
  successDark: '#4FC08A',
  warning: '#9A6B00',
  warningDark: '#E0A93C',
  danger: '#B3261E',
  dangerDark: '#F2938C',
} as const;

export interface ThemeColors {
  readonly background: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  /** Behind a photo tile while it loads. */
  readonly placeholder: string;
}

export const lightColors: ThemeColors = {
  background: palette.paper,
  surface: palette.paperSoft,
  surfaceRaised: palette.paper,
  border: palette.line,
  text: palette.ink,
  textMuted: palette.slate,
  textFaint: palette.mist,
  accent: palette.accent,
  onAccent: palette.paper,
  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  placeholder: palette.paperSoft,
};

export const darkColors: ThemeColors = {
  background: palette.ink,
  surface: palette.inkSoft,
  surfaceRaised: '#232329',
  border: palette.lineDark,
  text: '#F4F4F6',
  textMuted: palette.mist,
  textFaint: palette.slate,
  accent: palette.accentDark,
  onAccent: palette.ink,
  success: palette.successDark,
  warning: palette.warningDark,
  danger: palette.dangerDark,
  placeholder: palette.inkSoft,
};

/** 4pt base. Every margin and padding in the app comes from here. */
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
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
} as const;

export type TypographyVariant = keyof typeof typography;

export interface Theme {
  readonly colors: ThemeColors;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
  readonly isDark: boolean;
}

export const lightTheme: Theme = {
  colors: lightColors,
  spacing,
  radius,
  typography,
  isDark: false,
};

export const darkTheme: Theme = {
  colors: darkColors,
  spacing,
  radius,
  typography,
  isDark: true,
};
