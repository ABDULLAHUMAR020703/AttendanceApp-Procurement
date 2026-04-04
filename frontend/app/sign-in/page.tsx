'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../features/auth/AuthProvider';
import { BrandLogo } from '../../components/BrandLogo';

export default function SignInPage() {
  const { signIn, signOut, session, profile } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn({ email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      router.replace('/dashboard');
    }
  }, [session, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f0f1a] px-6 py-8">
      <Card className="w-full max-w-md p-6">
        <BrandLogo size="lg" className="justify-center mb-4" />
        <h1 className="text-2xl font-semibold text-center">Sign in</h1>
        <p className="text-sm text-muted-foreground mt-1 text-center">Use your Supabase email/password.</p>

        {session && profile ? (
          <div className="mt-4 rounded-lg bg-emerald-600/20 border border-emerald-500/30 p-3 text-sm text-emerald-200">
            Signed in as <span className="font-medium">{profile.name ?? profile.email ?? 'User'}</span> ({profile.role})
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <div className="space-y-2">
            <label className="block text-sm font-medium">Email</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Password</label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {error ? <div className="text-sm text-rose-300">{error}</div> : null}

          <Button
            className="w-full"
            disabled={loading}
            type="submit"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>

          {session ? (
            <Button
              className="w-full"
              variant="secondary"
              type="button"
              onClick={() => signOut()}
            >
              Sign out
            </Button>
          ) : null}
        </form>
      </Card>
    </div>
  );
}

