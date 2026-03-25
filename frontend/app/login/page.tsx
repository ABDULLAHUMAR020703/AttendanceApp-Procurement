'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../features/auth/AuthProvider';
import InteractiveBackground from '../../components/InteractiveBackground';
import Link from 'next/link';
import { User, Lock } from 'lucide-react';

export default function LoginPage() {
  const { signIn, session, profile } = useAuth();
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
    <div className="min-h-screen flex text-slate-200 font-sans relative overflow-hidden bg-transparent">
      <InteractiveBackground />
      
      {/* Header matching Landing Page but simpler */}
      <header className="absolute top-0 left-0 w-full flex items-center justify-between px-8 py-6 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full border border-slate-700 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <span className="font-bold tracking-widest text-sm uppercase">hadir.ai</span>
        </div>
        
        <nav className="hidden md:flex items-center gap-8 text-xs font-semibold tracking-wider text-slate-400">
          <Link href="#" className="hover:text-white transition-colors">ABOUT</Link>
          <Link href="#" className="hover:text-white transition-colors">FEATURES</Link>
          <Link href="#" className="hover:text-white transition-colors">PRICING</Link>
          <Link href="#" className="hover:text-white transition-colors">CONTACT</Link>
        </nav>

        <div className="flex items-center gap-4">
          <button className="w-9 h-9 rounded-full border border-slate-800 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm hover:bg-slate-800 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <circle cx="12" cy="12" r="4"></circle>
              <path d="M12 2v2"></path>
              <path d="M12 20v2"></path>
              <path d="m4.93 4.93 1.41 1.41"></path>
              <path d="m17.66 17.66 1.41 1.41"></path>
              <path d="M2 12h2"></path>
              <path d="M20 12h2"></path>
              <path d="m6.34 17.66-1.41 1.41"></path>
              <path d="m19.07 4.93-1.41 1.41"></path>
            </svg>
          </button>
          <Link href="/login" className="px-6 py-2 text-xs font-bold tracking-wider rounded border border-slate-800 bg-slate-900/50 hover:bg-slate-800 transition-colors backdrop-blur-sm">
            SIGN IN
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row items-center justify-center w-full max-w-6xl mx-auto px-6 z-10 pt-20">
        
        {/* Left Side: Login Form */}
        <div className="w-full md:w-1/2 flex justify-center mb-12 md:mb-0">
          <div className="w-full max-w-[400px]">
            <div className="bg-[#1a1731] border border-purple-900/40 rounded-3xl p-8 shadow-[0_0_50px_rgba(88,28,135,0.3)] relative overflow-hidden">
              {/* Inner glow */}
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-purple-500/10 to-transparent pointer-events-none"></div>
              
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-16 h-16 rounded-full border border-slate-600 flex items-center justify-center mb-8 bg-[#1f1b3b]">
                  <User size={24} className="text-slate-400" />
                </div>
                
                <form onSubmit={onSubmit} className="w-full space-y-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                      <User size={16} />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="EMAIL"
                      required
                      className="w-full bg-[#27234c] border border-slate-700/50 rounded-xl py-3 pl-12 pr-4 text-sm tracking-wider text-white placeholder-slate-400 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                  
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                      <Lock size={16} />
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="PASSWORD"
                      required
                      className="w-full bg-[#27234c] border border-slate-700/50 rounded-xl py-3 pl-12 pr-4 text-sm tracking-wider text-white placeholder-slate-400 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>

                  {error && <div className="text-sm text-rose-400 text-center">{error}</div>}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#6d28d9] hover:bg-[#5b21b6] border border-purple-500/50 text-white font-bold tracking-widest text-sm rounded-xl py-4 mt-2 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(109,40,217,0.4)]"
                  >
                    {loading ? 'SIGNING IN...' : 'LOGIN'}
                  </button>

                  <div className="flex items-center justify-between mt-4 text-xs font-medium text-slate-400">
                    <label className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors">
                      <input type="checkbox" className="rounded border-slate-700 bg-slate-800 text-purple-600 focus:ring-purple-600 outline-none" />
                      Remember me
                    </label>
                    <Link href="#" className="hover:text-white transition-colors">Forgot password?</Link>
                  </div>
                </form>

                <div className="mt-8 text-xs font-medium text-slate-400 text-center">
                  Not a member? <Link href="#" className="text-white hover:text-purple-300 transition-colors">Sign up now</Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Identity/Copy */}
        <div className="w-full md:w-1/2 flex flex-col justify-center pl-0 md:pl-16">
          <h1 className="text-5xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-purple-200 tracking-tight leading-none mb-6">
            hadir.AI<br />
            Procurement.
          </h1>
          <p className="text-slate-300 text-base md:text-lg leading-relaxed max-w-md font-medium">
            Automate your entire procurement workflow with role-based approvals, exception handling, and budget/PO tracking. From PO generation to GM approval, securely manage all spending centrally.
          </p>
        </div>

      </main>

      <footer className="absolute bottom-6 left-8 right-8 flex justify-between items-center text-[10px] text-slate-500 tracking-widest">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full border border-slate-700 flex items-center justify-center">N</div>
          <span>2026 hadir.AI Procurement</span>
        </div>
        <span>Powered by HADIR</span>
      </footer>
    </div>
  );
}
