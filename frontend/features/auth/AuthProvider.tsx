'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';

export type UserRole =
  | 'super_admin'
  | 'manager'
  | 'employee'
  | 'admin'
  | 'pm'
  | 'team_lead'
  | 'finance'
  | 'dept_head'
  | 'gm';

export type UserProfile = {
  userId: string;
  role: UserRole;
  department?: string | null;
  name?: string | null;
  email?: string | null;
};

type AuthContextValue = {
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const accessToken = session?.access_token ?? null;

  const supabase = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }, []);

  const refreshProfile = async () => {
    if (!accessToken) {
      setProfile(null);
      return;
    }

    const res = await fetch(`${backendBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('Failed to fetch profile from backend');
    const json = (await res.json()) as { user: UserProfile };
    setProfile(json.user);
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
    // Refresh role/profile after auth state changes.
    refreshProfile().catch(() => {
      // Keep UI functional even if RBAC mapping is incomplete.
      setProfile(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
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
    [session, profile, loading, accessToken, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

