import { cn } from '@/lib/ui';

const LABELS: Record<string, string> = {
  admin: 'Admin',
  pm: 'PM',
  dept_head: 'Dept head',
  employee: 'Employee',
};

function badgeClass(role: string): string {
  switch (role) {
    case 'admin':
      return 'bg-purple-500/20 text-purple-200 border-purple-500/35';
    case 'pm':
      return 'bg-blue-500/20 text-blue-200 border-blue-500/35';
    case 'dept_head':
      return 'bg-amber-500/20 text-amber-200 border-amber-500/35';
    case 'employee':
      return 'bg-slate-500/20 text-slate-200 border-slate-500/35';
    default:
      return 'bg-emerald-500/20 text-emerald-200 border-emerald-500/35';
  }
}

export function RoleBadge({ role }: { role: string }) {
  const label = LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className={cn(
        'inline-flex px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md border',
        badgeClass(role),
      )}
    >
      {label}
    </span>
  );
}
