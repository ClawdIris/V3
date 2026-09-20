import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';
import { inviteState, type InviteState, type InviteSummary } from '@/domain/invite';
import type { CreateInviteResult, InviteRow, RedeemInviteResult } from '@/types/database';

export interface InviteListItem extends InviteSummary {
  readonly state: InviteState;
}

export function useInvites(closetId: string | null): {
  invites: readonly InviteListItem[];
  isLoading: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: queryKeys.invites(closetId ?? 'none'),
    enabled: closetId !== null,
    queryFn: async (): Promise<InviteListItem[]> => {
      if (closetId === null) return [];
      const { data, error } = await supabase
        .from('invites')
        .select('id, code_hint, expires_at, redeemed_at, revoked_at')
        .eq('closet_id', closetId)
        .order('created_at', { ascending: false });
      if (error !== null) throw error;

      return ((data ?? []) as Pick<
        InviteRow,
        'id' | 'code_hint' | 'expires_at' | 'redeemed_at' | 'revoked_at'
      >[]).map((row) => {
        const summary: InviteSummary = {
          id: row.id,
          codeHint: row.code_hint,
          expiresAt: row.expires_at,
          redeemedAt: row.redeemed_at,
          revokedAt: row.revoked_at,
        };
        return { ...summary, state: inviteState(summary) };
      });
    },
  });

  return {
    invites: query.data ?? [],
    isLoading: query.isLoading,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Mints an invite. The plaintext code comes back exactly once — the server
 * stores only its SHA-256 — so the caller must show or share it immediately.
 */
export function useCreateInvite(closetId: string | null): {
  createInvite: () => Promise<CreateInviteResult>;
  isCreating: boolean;
  error: Error | null;
} {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<CreateInviteResult> => {
      if (closetId === null) throw new Error('No closet selected');
      const { data, error } = await supabase.rpc('create_invite', { p_closet: closetId });
      if (error !== null) throw error;
      const row = (data as CreateInviteResult[] | null)?.[0];
      if (row === undefined) throw new Error('No invite was created');
      return row;
    },
    onSuccess: () => {
      if (closetId !== null) {
        void client.invalidateQueries({ queryKey: queryKeys.invites(closetId) });
      }
    },
  });

  return {
    createInvite: () => mutation.mutateAsync(),
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}

export function useRevokeInvite(closetId: string | null): {
  revoke: (inviteId: string) => Promise<void>;
} {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (inviteId: string): Promise<void> => {
      const { error } = await supabase
        .from('invites')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', inviteId);
      if (error !== null) throw error;
    },
    onSuccess: () => {
      if (closetId !== null) {
        void client.invalidateQueries({ queryKey: queryKeys.invites(closetId) });
      }
    },
  });

  return {
    revoke: async (inviteId) => {
      await mutation.mutateAsync(inviteId);
    },
  };
}

export function useRedeemInvite(): {
  redeem: (code: string) => Promise<RedeemInviteResult>;
  isRedeeming: boolean;
} {
  const mutation = useMutation({
    mutationFn: async (code: string): Promise<RedeemInviteResult> => {
      const { data, error } = await supabase.rpc('redeem_invite', { p_code: code });
      if (error !== null) throw error;
      const row = (data as RedeemInviteResult[] | null)?.[0];
      if (row === undefined) throw new Error('No response from the server');
      return row;
    },
  });

  return { redeem: (code) => mutation.mutateAsync(code), isRedeeming: mutation.isPending };
}

export interface StylistRow {
  readonly membershipId: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly status: 'pending' | 'accepted' | 'revoked';
}

export function useStylists(closetId: string | null): {
  stylists: readonly StylistRow[];
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: queryKeys.members(closetId ?? 'none'),
    enabled: closetId !== null,
    queryFn: async (): Promise<StylistRow[]> => {
      if (closetId === null) return [];
      const { data, error } = await supabase
        .from('closet_members')
        .select('id, user_id, status, profiles:user_id ( display_name )')
        .eq('closet_id', closetId)
        .eq('role', 'stylist');
      if (error !== null) throw error;

      return (
        (data ?? []) as unknown as {
          id: string;
          user_id: string;
          status: StylistRow['status'];
          profiles: { display_name: string | null } | null;
        }[]
      ).map((row) => ({
        membershipId: row.id,
        userId: row.user_id,
        displayName: row.profiles?.display_name ?? null,
        status: row.status,
      }));
    },
  });

  return {
    stylists: query.data ?? [],
    refetch: () => {
      void query.refetch();
    },
  };
}

export function useSetStylistStatus(closetId: string | null): {
  setStatus: (membershipId: string, status: 'accepted' | 'revoked') => Promise<void>;
} {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      membershipId,
      status,
    }: {
      membershipId: string;
      status: 'accepted' | 'revoked';
    }): Promise<void> => {
      const { error } = await supabase
        .from('closet_members')
        .update({ status })
        .eq('id', membershipId);
      if (error !== null) throw error;
    },
    onSuccess: () => {
      if (closetId !== null) {
        void client.invalidateQueries({ queryKey: queryKeys.members(closetId) });
      }
    },
  });

  return {
    setStatus: async (membershipId, status) => {
      await mutation.mutateAsync({ membershipId, status });
    },
  };
}
