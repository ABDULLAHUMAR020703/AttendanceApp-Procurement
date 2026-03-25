import React from 'react';
import Link from 'next/link';

export default function Header() {
  return (
    <header className="absolute top-0 left-0 w-full flex items-center justify-between px-8 py-6 z-10 text-slate-200">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full border border-slate-700 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
        </div>
        <span className="font-bold tracking-widest text-sm uppercase">hadir.ai</span>
      </div>
      
      <nav className="hidden md:flex items-center gap-8 text-xs font-semibold tracking-wider text-slate-400">
        <Link href="/" className="hover:text-white transition-colors">HOME</Link>
        <Link href="#" className="hover:text-white transition-colors">ABOUT US</Link>
        <Link href="#" className="hover:text-white transition-colors">CONTACT US</Link>
        <Link href="#" className="hover:text-white transition-colors">FAQ</Link>
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
        <Link 
          href="/login" 
          className="px-6 py-2 text-xs font-bold tracking-wider rounded border border-slate-800 bg-slate-900/50 hover:bg-slate-800 transition-colors backdrop-blur-sm"
        >
          SIGN IN
        </Link>
      </div>
    </header>
  );
}
