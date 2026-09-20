import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/use-theme';

export interface ScreenProps {
  readonly children: ReactNode;
  readonly scroll?: boolean;
  readonly padded?: boolean;
  readonly edges?: readonly Edge[];
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'bottom'],
}: ScreenProps): React.JSX.Element {
  const { colors, spacing } = useTheme();
  const padding = padded ? spacing.lg : 0;

  return (
    <SafeAreaView
      edges={edges as Edge[]}
      style={[styles.fill, { backgroundColor: colors.background }]}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding, paddingBottom: padding + spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, { padding }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
