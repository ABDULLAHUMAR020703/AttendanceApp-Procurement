'use client';

import { Button } from './ui/Button';

export type ActorSummary = { id: string; name?: string | null; email?: string | null; role?: string | null } | null;

function formatRole(role: string | null | undefined): string {
  if (!role) return '';
  if (role === 'pm') return 'PM';
  if (role === 'admin') return 'Admin';
  if (role === 'employee') return 'Team member';
  return role;
}

function displayName(actor: ActorSummary): string {
  if (!actor) return 'Unknown';
  return actor.name?.trim() || actor.email?.trim() || actor.id.slice(0, 8) + '…';
}

function isWithin24h(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

type Props = {
  updatedAt: string | null | undefined;
  updatedBy: ActorSummary;
  onViewHistory?: () => void;
  className?: string;
};

export function LastUpdatedPanel({ updatedAt, updatedBy, onViewHistory, className }: Props) {
  const recent = isWithin24h(updatedAt ?? null);
  const when = updatedAt ? new Date(updatedAt).toLocaleString() : '—';
  const who = updatedBy ? `${displayName(updatedBy)} (${formatRole(updatedBy.role)})` : '—';

  return (
    <div className={`rounded-lg border border-white/10 bg-[#2a2640]/60 px-4 py-3 text-sm space-y-2 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {recent ? (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-200">
            Recently updated
          </span>
        ) : null}
      </div>
      <div className="text-muted-foreground">
        Last updated: <span className="text-foreground">{when}</span>
      </div>
      <div className="text-muted-foreground">
        Updated by: <span className="text-foreground">{who}</span>
      </div>
      {onViewHistory ? (
        <Button type="button" variant="secondary" className="mt-1 text-xs px-3 py-1.5" onClick={onViewHistory}>
          View history
        </Button>
      ) : null}
    </div>
  );
}
