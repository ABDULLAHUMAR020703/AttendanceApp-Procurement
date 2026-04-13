'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { getBrowserSupabase } from '../../lib/supabase-browser';
import type { AppPermissionId } from '@/lib/permissions';
import { APP_PERMISSION_IDS } from '@/lib/permissions';

export type UserRole = 'admin' | 'pm' | 'dept_head' | 'employee';

/** `departments.code` from the API (dynamic list). */
export type Department = string;

export type UserProfile = {
  userId: string;
  role: UserRole;
  department?: string | null;
  name?: string | null;
  email?: string | null;
  /** Effective app permissions (non-admin). Admins bypass checks server-side. */
  permissions?: AppPermissionId[];
};

type AuthContextValue = {
  supabase: SupabaseClient | null;
  session: Session | null;
  accessToken: string | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (params: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const accessToken = session?.access_token ?? null;

  const supabase = useMemo(() => getBrowserSupabase(), []);

  const refreshProfile = async () => {
    if (!supabase) {
      setProfile(null);
      return;
    }

    const {
      data: { session: fresh },
    } = await supabase.auth.getSession();
    const token = fresh?.access_token;
    if (!token) {
      setProfile(null);
      return;
    }

    const res = await fetch(`${backendBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch profile from backend');
    const json = (await res.json()) as {
      user: {
        userId: string;
        role: UserRole;
        department?: string | null;
        name?: string | null;
        email?: string | null;
        permissions?: string[];
      };
    };

    const raw = json.user as Record<string, unknown>;
    const userId = (raw.userId ?? raw.user_id) as string;

    const permRaw = json.user.permissions;
    const permissions: AppPermissionId[] | undefined =
      json.user.role === 'admin'
        ? undefined
        : Array.isArray(permRaw)
          ? (permRaw.filter((p): p is AppPermissionId =>
              (APP_PERMISSION_IDS as readonly string[]).includes(p as string),
            ) as AppPermissionId[])
          : [];

    setProfile({
      userId,
      role: json.user.role as UserRole,
      department: json.user.department ?? null,
      name: json.user.name ?? null,
      email: json.user.email ?? null,
      permissions,
    });
  };

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'SIGNED_IN') {
        void queryClient.invalidateQueries();
      }
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!accessToken) {
      setProfile(null);
      return;
    }
    refreshProfile().catch(() => {
      setProfile(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      supabase,
      session,
      accessToken,
      profile,
      loading,
      signIn: async ({ email, password }) => {
        if (!supabase) throw new Error('Supabase is not configured (missing env vars)');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await queryClient.invalidateQueries();
      },
      signOut: async () => {
        if (!supabase) throw new Error('Supabase is not configured (missing env vars)');
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        queryClient.clear();
      },
      refreshProfile,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, session, profile, loading, accessToken, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
