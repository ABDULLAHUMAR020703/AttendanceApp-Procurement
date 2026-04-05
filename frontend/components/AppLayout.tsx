'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useAuth } from '../features/auth/AuthProvider';
import { Button } from './ui/Button';
import { cn } from '@/lib/ui';
import InteractiveBackground from './InteractiveBackground';
import { BrandLogo } from './BrandLogo';

const navItems = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
  },
  { href: '/po/upload', label: 'PO Upload', roles: ['admin', 'pm', 'dept_head'] },
  {
    href: '/projects',
    label: 'Projects',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
  },
  {
    href: '/purchase-requests',
    label: 'Purchase Requests',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
  },
  {
    href: '/approvals',
    label: 'Approvals',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
  },
  { href: '/admin/users', label: 'Admin: Users', roles: ['admin'] },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const role = profile?.role;
  const items = useMemo(() => navItems.filter((n) => (role ? n.roles.includes(role) : false)), [role]);

  return (
    <div className="min-h-screen flex text-slate-200 font-sans relative overflow-hidden bg-transparent">
      <InteractiveBackground />
      <aside className="w-72 border-r border-slate-800/60 bg-[#121124]/80 backdrop-blur-md px-4 py-6 z-10 flex flex-col">
        <div className="mb-8 px-3">
          <BrandLogo size="md">
            <div>
              <div className="text-sm font-bold tracking-widest uppercase">hadir.AI</div>
              <div className="text-[10px] tracking-wider text-slate-400 uppercase">Procurement</div>
            </div>
          </BrandLogo>
        </div>
        <nav className="space-y-2 flex-1">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cn(
                'block rounded-xl px-4 py-3 text-sm border border-transparent transition-all font-medium tracking-wide',
                pathname === i.href
                  ? 'bg-purple-600/20 border-purple-500/30 text-white shadow-[0_0_15px_rgba(147,51,234,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 hover:border-slate-800/50',
              )}
            >
              {i.label}
            </Link>
          ))}
        </nav>

        <div className="mt-8 text-xs text-slate-400 bg-slate-900/40 rounded-xl p-4 border border-slate-800/50 backdrop-blur-sm">
          {profile ? (
            <div className="space-y-4">
              <div className="truncate">
                <div className="font-bold tracking-wider text-slate-200 mb-1">{profile.name ?? profile.email ?? 'User'}</div>
                <div className="text-[10px] tracking-widest uppercase text-purple-400">{profile.role}</div>
                {profile.department ? (
                  <div className="text-[10px] tracking-wider text-slate-500 uppercase mt-0.5">{profile.department}</div>
                ) : null}
              </div>
              <Button
                className="w-full bg-[#6d28d9]/20 hover:bg-[#6d28d9]/40 border border-purple-500/30 text-purple-200 transition-colors py-2 rounded-lg font-bold tracking-wider text-[10px] uppercase"
                variant="secondary"
                onClick={async () => {
                  await signOut();
                  router.replace('/login');
                }}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <div>Signing in...</div>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 z-10 relative">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
