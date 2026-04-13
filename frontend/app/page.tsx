import React from 'react';
import Header from '../components/Header';
import InteractiveBackground from '../components/InteractiveBackground';
import { BrandLogo } from '../components/BrandLogo';
import Link from 'next/link';
import { APP_NAME } from '@/lib/appMeta';

export default function LandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden font-sans">
      <InteractiveBackground />
      <Header />
      
      <main className="pt-40 px-6 max-w-7xl mx-auto flex flex-col items-center justify-center text-center">
        <div className="max-w-3xl space-y-6 mt-16">
          <BrandLogo size="xl" className="justify-center mb-2" />
          <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-purple-200 tracking-tight leading-tight">
            {APP_NAME}
            <br />
            <span className="text-5xl md:text-7xl">Procurement</span>
          </h1>
          <p className="text-slate-300 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto font-medium">
            Automate procurement with role-based approvals, exception handling, and budget / PO tracking—from PO lines to final sign-off, all in one place.
          </p>
          <div className="pt-8">
            <Link 
              href="/login"
              className="inline-flex items-center justify-center px-8 py-3 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-bold tracking-wide transition-all hover:scale-105 shadow-[0_0_30px_rgba(147,51,234,0.3)]"
            >
              LEARN MORE 
              <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </div>

        <div className="mt-40 w-full mb-20">
          <div className="inline-block px-4 py-1.5 rounded-full border border-slate-800 bg-slate-900/50 backdrop-blur-sm mb-8 text-xs font-bold tracking-widest text-purple-300 uppercase">
            Platform Features
          </div>
          <h2 className="text-4xl md:text-5xl font-black mb-4">
            Everything you need for<br />
            <span className="text-cyan-400">smarter approvals</span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto mb-16">
            Centralize your workflows securely from PO creation to finance sign-off.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-[#121124]/80 backdrop-blur-sm border border-slate-800/60 p-8 rounded-2xl flex flex-col items-center justify-center text-center hover:bg-[#16152b] transition-colors">
              <h3 className="text-4xl font-black text-cyan-400 mb-2">Multi-Tier</h3>
              <p className="text-sm font-medium text-slate-400">Approval Workflows</p>
            </div>
            <div className="bg-[#121124]/80 backdrop-blur-sm border border-slate-800/60 p-8 rounded-2xl flex flex-col items-center justify-center text-center hover:bg-[#16152b] transition-colors">
              <h3 className="text-4xl font-black text-blue-400 mb-2">Budgets</h3>
              <p className="text-sm font-medium text-slate-400">PO & Project Limits</p>
            </div>
            <div className="bg-[#121124]/80 backdrop-blur-sm border border-slate-800/60 p-8 rounded-2xl flex flex-col items-center justify-center text-center hover:bg-[#16152b] transition-colors">
              <h3 className="text-4xl font-black text-cyan-300 mb-2">Exceptions</h3>
              <p className="text-sm font-medium text-slate-400">Smart Handling</p>
            </div>
            <div className="bg-[#121124]/80 backdrop-blur-sm border border-slate-800/60 p-8 rounded-2xl flex flex-col items-center justify-center text-center hover:bg-[#16152b] transition-colors">
              <h3 className="text-4xl font-black text-purple-400 mb-2">RBAC</h3>
              <p className="text-sm font-medium text-slate-400">Secure Roles</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
