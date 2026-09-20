import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { Text } from './text';
import { useTheme } from '@/theme/use-theme';

export interface FieldProps extends TextInputProps {
  readonly label: string;
  readonly error?: string | null;
  readonly hint?: string;
}

export function Field({ label, error, hint, style, ...rest }: FieldProps): React.JSX.Element {
  const { colors, radius, spacing } = useTheme();
  const invalid = typeof error === 'string' && error.length > 0;

  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        {...rest}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: invalid ? colors.danger : colors.border,
            borderRadius: radius.md,
            color: colors.text,
            paddingHorizontal: spacing.md,
          },
          style,
        ]}
      />
      {invalid ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, fontSize: 16, minHeight: 48 },
});
