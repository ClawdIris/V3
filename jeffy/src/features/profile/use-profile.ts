import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import type { BudgetRow, ProfileRow, ProfileUpdate } from '@/types/database';
import type { BudgetRange } from '@/domain/budget';
import { toRange } from '@/domain/budget';

export interface UseProfileResult {
  readonly profile: ProfileRow | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

export function useProfile(): UseProfileResult {
  const { user, status } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: queryKeys.profile(userId ?? 'anonymous'),
    enabled: userId !== null && status === 'signed-in',
    queryFn: async (): Promise<ProfileRow | null> => {
      if (userId === null) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error !== null) throw error;
      return (data as ProfileRow | null) ?? null;
    },
  });

  return {
    profile: query.data ?? null,
    // A signed-out user has no profile to wait for.
    isLoading: userId !== null && status === 'signed-in' && query.isLoading,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

export function useUpdateProfile(): {
  update: (patch: ProfileUpdate) => Promise<void>;
  isSaving: boolean;
  error: Error | null;
} {
  const { user } = useAuth();
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (patch: ProfileUpdate): Promise<void> => {
      if (user === null) throw new Error('Not signed in');
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
      if (error !== null) throw error;
    },
    onSuccess: () => {
      if (user !== null) {
        void client.invalidateQueries({ queryKey: queryKeys.profile(user.id) });
      }
    },
  });

  return {
    update: async (patch) => {
      await mutation.mutateAsync(patch);
    },
    isSaving: mutation.isPending,
    error: mutation.error,
  };
}

export function useBudgets(profileId: string | null): {
  ranges: readonly BudgetRange[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.budgets(profileId ?? 'anonymous'),
    enabled: profileId !== null,
    queryFn: async (): Promise<BudgetRange[]> => {
      if (profileId === null) return [];
      const { data, error } = await supabase
        .from('budgets')
        .select('*')
        .eq('profile_id', profileId);
      if (error !== null) throw error;
      return ((data ?? []) as BudgetRow[]).map(toRange);
    },
  });

  return { ranges: query.data ?? [], isLoading: query.isLoading };
}
