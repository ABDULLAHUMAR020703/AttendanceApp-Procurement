'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Settings } from 'lucide-react';
import { useAuth } from '../features/auth/AuthProvider';
import { Button } from './ui/Button';
import { cn } from '@/lib/ui';
import InteractiveBackground from './InteractiveBackground';
import { BrandLogo } from './BrandLogo';
import { APP_NAME } from '@/lib/appMeta';
import {
  hasAnyDashboardPermission,
  hasAppPermission,
  type AppPermissionId,
} from '@/lib/permissions';
import type { UserProfile } from '../features/auth/AuthProvider';

type NavItem = {
  href: string;
  label: string;
  roles: Array<'employee' | 'admin' | 'pm' | 'dept_head'>;
  /** Admins always pass. */
  permission?: AppPermissionId | 'dashboard_any';
};

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
    permission: 'dashboard_any',
  },
  { href: '/po/upload', label: 'PO Upload', roles: ['admin', 'pm', 'dept_head'], permission: 'view_pos' },
  {
    href: '/projects',
    label: 'Projects',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
    permission: 'view_projects',
  },
  {
    href: '/purchase-requests',
    label: 'Purchase Requests',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
    permission: 'view_projects',
  },
  {
    href: '/approvals',
    label: 'Approvals',
    roles: ['employee', 'admin', 'pm', 'dept_head'],
    permission: 'view_approvals',
  },
  { href: '/admin/users', label: 'Admin: Users', roles: ['admin'] },
];

function navItemAllowed(profile: UserProfile, item: NavItem): boolean {
  if (!item.roles.includes(profile.role)) return false;
  if (profile.role === 'admin') return true;
  if (!item.permission) return true;
  if (item.permission === 'dashboard_any') return hasAnyDashboardPermission(profile);
  return hasAppPermission(profile, item.permission);
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const items = useMemo(() => {
    if (!profile) return [];
    return navItems.filter((n) => navItemAllowed(profile, n));
  }, [profile]);
  const showSettings = profile?.role === 'admin';

  const linkClass = (href: string, active: boolean) =>
    cn(
      'block rounded-xl px-4 py-3 text-sm border transition-all font-medium tracking-wide',
      active
        ? 'bg-purple-600/20 border-purple-500/30 text-white shadow-[0_0_15px_rgba(147,51,234,0.15)]'
        : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5 hover:border-slate-800/50',
    );

  return (
    <div className="min-h-screen flex text-slate-200 font-sans relative overflow-hidden bg-transparent">
      <InteractiveBackground />
      <aside className="w-72 border-r border-slate-800/60 bg-[#121124]/80 backdrop-blur-md px-4 py-6 z-10 flex flex-col min-h-screen">
        <div className="mb-8 px-3 shrink-0">
          <BrandLogo size="md">
            <div>
              <div className="text-sm font-bold tracking-tight text-white">{APP_NAME}</div>
              <div className="text-[10px] tracking-wider text-slate-400">Tehsil T Procurement</div>
            </div>
          </BrandLogo>
        </div>

        <nav className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {items.map((i) => (
              <Link key={i.href} href={i.href} className={linkClass(i.href, pathname === i.href)}>
                {i.label}
              </Link>
            ))}
          </div>

          {showSettings ? (
            <>
              <div className="shrink-0 my-4 border-t border-slate-800/60" aria-hidden />
              <Link
                href="/settings"
                className={cn(
                  'group shrink-0 flex items-center gap-3 rounded-xl px-4 py-3 text-sm border transition-all duration-300 font-medium tracking-wide',
                  pathname.startsWith('/settings')
                    ? 'bg-purple-600/20 border-purple-500/30 text-white shadow-[0_0_15px_rgba(147,51,234,0.15)]'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5 hover:border-slate-800/50 hover:shadow-[0_0_22px_rgba(147,51,234,0.18)]',
                )}
              >
                <Settings
                  className={cn(
                    'w-4 h-4 shrink-0 transition-all',
                    pathname.startsWith('/settings')
                      ? 'text-purple-300'
                      : 'text-slate-500 group-hover:text-purple-200 group-hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.45)]',
                  )}
                  aria-hidden
                />
                Settings
              </Link>
            </>
          ) : null}
        </nav>

        <div className="mt-4 shrink-0 text-xs text-slate-400 bg-slate-900/40 rounded-xl p-4 border border-slate-800/50 backdrop-blur-sm">
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
