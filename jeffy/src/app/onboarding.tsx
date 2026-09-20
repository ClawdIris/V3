import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useProfile, useUpdateProfile } from '@/features/profile/use-profile';
import { parsePriceToCents } from '@/domain/budget';
import { supabase } from '@/lib/supabase';
import { useAppLock } from '@/providers/app-lock-provider';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';
import { ITEM_CATEGORIES, type ItemCategory } from '@/types/database';

/**
 * First-run setup: name, sizes, budget, lock.
 *
 * Everything here is optional (the brief says so), so every step has a Skip
 * and none of them block finishing. The nudge is the ordering and the copy,
 * not a required field.
 */

type Step = 'name' | 'sizes' | 'budget' | 'lock';

const STEPS: readonly Step[] = ['name', 'sizes', 'budget', 'lock'];

export default function OnboardingScreen(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile();
  const { update } = useUpdateProfile();
  const lock = useAppLock();
  const { spacing } = useTheme();

  const [step, setStep] = useState<Step>('name');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [shirt, setShirt] = useState('');
  const [waist, setWaist] = useState('');
  const [inseam, setInseam] = useState('');
  const [shoe, setShoe] = useState('');
  const [jacket, setJacket] = useState('');
  const [monthly, setMonthly] = useState('');
  const [ranges, setRanges] = useState<Record<ItemCategory, string>>({
    top: '',
    bottom: '',
    outerwear: '',
    shoes: '',
    accessory: '',
  });

  const index = STEPS.indexOf(step);

  const advance = (): void => {
    const next = STEPS[index + 1];
    if (next === undefined) {
      void finish();
      return;
    }
    setStep(next);
  };

  const finish = async (): Promise<void> => {
    if (user === null) return;
    setBusy(true);
    setError(null);
    try {
      const toInt = (value: string): number | null => {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const toFloat = (value: string): number | null => {
        const parsed = Number.parseFloat(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
      };
      const text = (value: string): string | null =>
        value.trim().length === 0 ? null : value.trim();

      await update({
        display_name: text(displayName),
        shirt_size: text(shirt),
        pants_waist: toInt(waist),
        pants_length: toInt(inseam),
        shoe_size: toFloat(shoe),
        jacket_size: text(jacket),
        monthly_budget_cents: parsePriceToCents(monthly),
        // Setting this is what lets the auth gate stop routing here.
        onboarded_at: new Date().toISOString(),
      });

      const budgetRows = ITEM_CATEGORIES.flatMap((category) => {
        const max = parsePriceToCents(ranges[category]);
        return max === null ? [] : [{ profile_id: user.id, category, min_cents: 0, max_cents: max }];
      });

      if (budgetRows.length > 0) {
        const { error: budgetError } = await supabase
          .from('budgets')
          .upsert(budgetRows, { onConflict: 'profile_id,category' });
        if (budgetError !== null) throw budgetError;
      }

      router.replace('/(tabs)');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text variant="caption" tone="faint" style={{ marginTop: spacing.lg }}>
        Step {index + 1} of {STEPS.length}
      </Text>

      {step === 'name' ? (
        <>
          <Text variant="title" style={{ marginVertical: spacing.md }}>
            What should we call you?
          </Text>
          <Text variant="body" tone="muted" style={{ marginBottom: spacing.lg }}>
            Your stylist will see this name.
          </Text>
          <Field label="Name" value={displayName} onChangeText={setDisplayName} />
        </>
      ) : null}

      {step === 'sizes' ? (
        <>
          <Text variant="title" style={{ marginVertical: spacing.md }}>
            Your sizes
          </Text>
          <Text variant="body" tone="muted" style={{ marginBottom: spacing.lg }}>
            All optional, but worth two minutes: it is how Jeffy checks a store find
            actually comes in your size before you get attached to it.
          </Text>
          <Field label="Shirt" value={shirt} onChangeText={setShirt} placeholder="M" />
          <Field
            label="Trouser waist"
            value={waist}
            onChangeText={setWaist}
            keyboardType="number-pad"
            placeholder="32"
          />
          <Field
            label="Trouser inseam"
            value={inseam}
            onChangeText={setInseam}
            keyboardType="number-pad"
            placeholder="30"
          />
          <Field
            label="Shoe"
            value={shoe}
            onChangeText={setShoe}
            keyboardType="decimal-pad"
            placeholder="10.5"
          />
          <Field label="Jacket" value={jacket} onChangeText={setJacket} placeholder="40R" />
        </>
      ) : null}

      {step === 'budget' ? (
        <>
          <Text variant="title" style={{ marginVertical: spacing.md }}>
            What feels comfortable to spend?
          </Text>
          <Text variant="body" tone="muted" style={{ marginBottom: spacing.lg }}>
            Jeffy flags anything over these, and your stylist sees them so their
            recommendations stay realistic.
          </Text>
          <Field
            label="Monthly clothing budget"
            value={monthly}
            onChangeText={setMonthly}
            keyboardType="decimal-pad"
            placeholder="150"
          />
          {ITEM_CATEGORIES.map((category) => (
            <Field
              key={category}
              label={`Most you would pay for ${category}`}
              value={ranges[category]}
              onChangeText={(value) => setRanges((r) => ({ ...r, [category]: value }))}
              keyboardType="decimal-pad"
              placeholder="80"
            />
          ))}
        </>
      ) : null}

      {step === 'lock' ? (
        <>
          <Text variant="title" style={{ marginVertical: spacing.md }}>
            Lock Jeffy?
          </Text>
          <Text variant="body" tone="muted" style={{ marginBottom: spacing.lg }}>
            {lock.isSupported
              ? 'Require Face ID, Touch ID or your passcode whenever Jeffy opens. You can change this any time in settings.'
              : 'This device has no biometrics set up, so the lock is unavailable. You can turn it on later from settings.'}
          </Text>
          {lock.isSupported ? (
            <Button
              title={lock.isEnabled ? 'Lock is on' : 'Turn on the lock'}
              variant="secondary"
              disabled={lock.isEnabled}
              onPress={() => {
                void lock.enable();
              }}
            />
          ) : null}
        </>
      ) : null}

      {error !== null ? (
        <Text variant="caption" tone="danger" style={{ marginTop: spacing.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ height: spacing.xl }} />
      <Button
        title={index === STEPS.length - 1 ? 'Finish' : 'Continue'}
        onPress={advance}
        loading={busy}
      />
      <View style={{ height: spacing.sm }} />
      <Button
        title={index === STEPS.length - 1 ? 'Finish without this' : 'Skip'}
        variant="ghost"
        onPress={advance}
        disabled={busy}
      />
    </Screen>
  );
}
