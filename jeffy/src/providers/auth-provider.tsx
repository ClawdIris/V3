import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { isAppleSignInAvailable, signInWithApple as appleSignIn } from '@/lib/apple-auth';
import { passwordResetRedirect } from '@/lib/links';
import { startSupabaseAutoRefresh, supabase } from '@/lib/supabase';
import type { ClosetRole } from '@/types/database';

/**
 * Auth and closet membership.
 *
 * "Which closet am I looking at?" is an auth-level question in Jeffy, because
 * one account can own its own closet and be a stylist on someone else's. The
 * active closet plus the caller's role in it is what every feature branches
 * on, so it lives here rather than being re-derived per screen.
 */

export interface ClosetMembership {
  readonly closetId: string;
  readonly closetName: string;
  readonly role: ClosetRole;
  readonly ownerId: string;
  readonly ownerName: string | null;
}

export interface AuthState {
  readonly status: 'loading' | 'signed-out' | 'signed-in';
  readonly session: Session | null;
  readonly user: User | null;
  readonly memberships: readonly ClosetMembership[];
  readonly activeCloset: ClosetMembership | null;
  readonly isAppleAvailable: boolean;
}

export interface AuthActions {
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signInWithApple(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  setActiveCloset(closetId: string): void;
  refreshMemberships(): Promise<void>;
}

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

interface MembershipQueryRow {
  role: ClosetRole;
  closets: {
    id: string;
    name: string;
    owner_id: string;
    profiles: { display_name: string | null } | null;
  } | null;
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [memberships, setMemberships] = useState<readonly ClosetMembership[]>([]);
  const [activeClosetId, setActiveClosetId] = useState<string | null>(null);
  const [isAppleAvailable, setAppleAvailable] = useState(false);

  const loadMemberships = useCallback(async (userId: string): Promise<void> => {
    const { data, error } = await supabase
      .from('closet_members')
      .select('role, closets ( id, name, owner_id, profiles:owner_id ( display_name ) )')
      .eq('user_id', userId)
      .eq('status', 'accepted');

    if (error !== null) {
      // A membership read failure must not strand the user on a spinner; they
      // land signed-in with no closets and a retry available in settings.
      console.warn('[auth] could not load memberships', error.message);
      setMemberships([]);
      return;
    }

    const rows = (data ?? []) as unknown as MembershipQueryRow[];
    const next: ClosetMembership[] = rows.flatMap((row) =>
      row.closets === null
        ? []
        : [
            {
              closetId: row.closets.id,
              closetName: row.closets.name,
              role: row.role,
              ownerId: row.closets.owner_id,
              ownerName: row.closets.profiles?.display_name ?? null,
            },
          ],
    );

    // Own closet first, so the app opens on your own wardrobe.
    next.sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1));
    setMemberships(next);
    setActiveClosetId((current) =>
      current !== null && next.some((m) => m.closetId === current)
        ? current
        : (next[0]?.closetId ?? null),
    );
  }, []);

  useEffect(() => {
    const stopRefresh = startSupabaseAutoRefresh();
    let cancelled = false;

    void (async () => {
      setAppleAvailable(await isAppleSignInAvailable());

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      setSession(data.session);
      if (data.session !== null) await loadMemberships(data.session.user.id);
      if (!cancelled) setStatus(data.session === null ? 'signed-out' : 'signed-in');
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession === null ? 'signed-out' : 'signed-in');

      if (nextSession === null) {
        setMemberships([]);
        setActiveClosetId(null);
        return;
      }
      // TOKEN_REFRESHED fires often and changes no membership.
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        void loadMemberships(nextSession.user.id);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
      stopRefresh();
    };
  }, [loadMemberships]);

  const actions = useMemo<AuthActions>(
    () => ({
      async signUp(email, password, displayName) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          // Read by handle_new_user() to seed the profile and first closet.
          options: { data: { display_name: displayName.trim() } },
        });
        if (error !== null) throw error;
      },

      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error !== null) throw error;
      },

      async signInWithApple() {
        // Native: identity token exchange. Web: OAuth redirect. Same call site.
        await appleSignIn();
      },

      async sendPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: passwordResetRedirect(),
        });
        if (error !== null) throw error;
      },

      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error !== null) throw error;
      },

      setActiveCloset(closetId) {
        setActiveClosetId(closetId);
      },

      async refreshMemberships() {
        const { data } = await supabase.auth.getUser();
        if (data.user !== null) await loadMemberships(data.user.id);
      },
    }),
    [loadMemberships],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      memberships,
      activeCloset: memberships.find((m) => m.closetId === activeClosetId) ?? null,
      isAppleAvailable,
      ...actions,
    }),
    [status, session, memberships, activeClosetId, isAppleAvailable, actions],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * The active closet, for screens that cannot render without one. Throws rather
 * than returning null so a caller cannot silently read the wrong closet.
 */
export function useActiveCloset(): ClosetMembership {
  const { activeCloset } = useAuth();
  if (activeCloset === null) throw new Error('No active closet');
  return activeCloset;
}
