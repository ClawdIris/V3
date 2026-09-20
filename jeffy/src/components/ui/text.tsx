import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/use-theme';
import type { TypographyVariant } from '@/theme/tokens';

type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'success' | 'warning';

export interface AppTextProps extends TextProps {
  readonly variant?: TypographyVariant;
  readonly tone?: Tone;
  readonly style?: StyleProp<TextStyle>;
}

export function Text({
  variant = 'body',
  tone = 'default',
  style,
  ...rest
}: AppTextProps): React.JSX.Element {
  const theme = useTheme();
  const colors = theme.colors;

  const color: string =
    tone === 'muted'
      ? colors.textMuted
      : tone === 'faint'
        ? colors.textFaint
        : tone === 'accent'
          ? colors.accent
          : tone === 'danger'
            ? colors.danger
            : tone === 'success'
              ? colors.success
              : tone === 'warning'
                ? colors.warning
                : colors.text;

  const base = theme.typography[variant];

  return (
    <RNText
      {...rest}
      style={[
        {
          color,
          fontSize: base.fontSize,
          lineHeight: base.lineHeight,
          fontWeight: base.fontWeight,
        },
        style,
      ]}
    />
  );
}
