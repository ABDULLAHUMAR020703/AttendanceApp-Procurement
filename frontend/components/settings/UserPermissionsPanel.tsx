'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../ui/Table';
import { ApiError, authedFetchWithSupabase } from '@/lib/api';
import { PERMISSION_COLUMNS, type AppPermissionId } from '@/lib/permissions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/features/auth/AuthProvider';
import { APP_PERMISSION_IDS } from '@/lib/permissions';
import { RoleBadge } from './RoleBadge';

export type UserPermissionMatrixRow = {
  user_id: string;
  name: string;
  department: string;
  role: string;
  permissions: AppPermissionId[];
  is_admin: boolean;
};

function normalizePermissions(raw: unknown): AppPermissionId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is AppPermissionId =>
    (APP_PERMISSION_IDS as readonly string[]).includes(p as string),
  );
}

type Props = {
  supabase: SupabaseClient | null;
  users: UserPermissionMatrixRow[] | undefined;
  isLoading: boolean;
  error: unknown;
};

function sortPerms(list: AppPermissionId[]): string {
  return [...list].sort().join(',');
}

export function UserPermissionsPanel({ supabase, users: usersProp, isLoading, error }: Props) {
  const queryClient = useQueryClient();
  const { refreshProfile } = useAuth();
  const [draft, setDraft] = useState<Record<string, AppPermissionId[]>>({});
  const [baseline, setBaseline] = useState<Record<string, AppPermissionId[]>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());

  const users = usersProp ?? [];

  const serverSig = useMemo(
    () => JSON.stringify(users.map((u) => [u.user_id, u.role, u.permissions, u.is_admin])),
    [users],
  );

  useEffect(() => {
    if (!users.length) return;
    const next: Record<string, AppPermissionId[]> = {};
    const base: Record<string, AppPermissionId[]> = {};
    for (const u of users) {
      const list = normalizePermissions(u.permissions);
      next[u.user_id] = [...list];
      base[u.user_id] = [...list];
    }
    setDraft(next);
    setBaseline(base);
  }, [serverSig]);

  const dirtyUserIds = useMemo(() => {
    return users
      .filter((u) => !u.is_admin)
      .map((u) => u.user_id)
      .filter((id) => sortPerms(draft[id] ?? []) !== sortPerms(baseline[id] ?? []));
  }, [users, draft, baseline]);

  const isDirty = dirtyUserIds.length > 0;

  const toggle = useCallback((userId: string, perm: AppPermissionId, isAdmin: boolean) => {
    if (isAdmin) return;
    setDraft((prev) => {
      const cur = prev[userId] ?? [];
      const has = cur.includes(perm);
      const next = has ? cur.filter((p) => p !== perm) : [...cur, perm];
      return { ...prev, [userId]: next };
    });
  }, []);

  const toggleColumnAll = useCallback(
    (perm: AppPermissionId, checked: boolean) => {
      setDraft((prev) => {
        const next = { ...prev };
        for (const u of users) {
          if (u.is_admin) continue;
          const cur = next[u.user_id] ?? [];
          if (checked) {
            if (!cur.includes(perm)) next[u.user_id] = [...cur, perm];
          } else {
            next[u.user_id] = cur.filter((p) => p !== perm);
          }
        }
        return next;
      });
    },
    [users],
  );

  const columnAllChecked = useCallback(
    (perm: AppPermissionId) => {
      const nonAdmin = users.filter((u) => !u.is_admin);
      if (nonAdmin.length === 0) return false;
      return nonAdmin.every((u) => (draft[u.user_id] ?? []).includes(perm));
    },
    [users, draft],
  );

  const saveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        setSavingIds((s) => new Set(s).add(id));
        try {
          await authedFetchWithSupabase(supabase!, `/api/permissions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissions: draft[id] ?? [] }),
          });
        } finally {
          setSavingIds((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        }
      }
    },
    onSuccess: async () => {
      toast.success('Permissions updated');
      await queryClient.invalidateQueries({ queryKey: ['permissions', 'matrix'] });
      await refreshProfile();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save permissions');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">User permissions</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Fine-grained access on top of roles. Admins always have full access. Use Save to apply all pending changes.
          </p>
        </div>
        <Button
          type="button"
          disabled={!isDirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate(dirtyUserIds)}
          className="shrink-0"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {isLoading ? (
        <Card className="p-4 text-sm text-muted-foreground">Loading users…</Card>
      ) : error ? (
        <Card className="p-4 text-sm text-rose-300">
          {error instanceof Error ? error.message : 'Failed to load permissions'}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden border border-white/10">
          <TableWrapper className="max-h-[min(70vh,640px)] overflow-auto">
            <Table>
              <THead className="sticky top-0 z-20 bg-[#121124]/95 backdrop-blur-md border-b border-white/10 shadow-[0_1px_0_rgba(255,255,255,0.06)]">
                <TR>
                  <TH className="min-w-[140px] sticky left-0 z-30 bg-[#121124]/95 backdrop-blur-md">User</TH>
                  <TH className="min-w-[96px]">Role</TH>
                  <TH className="min-w-[100px]">Department</TH>
                  {PERMISSION_COLUMNS.map((col) => (
                    <TH key={col.id} className="min-w-[120px] text-center whitespace-normal">
                      <label className="flex flex-col items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="rounded border-white/20 bg-[#2a2640]"
                          checked={columnAllChecked(col.id)}
                          onChange={(e) => toggleColumnAll(col.id, e.target.checked)}
                          title="Select all in column"
                        />
                        <span className="text-[10px] leading-tight font-medium text-slate-300">{col.label}</span>
                      </label>
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {users.map((u) => {
                  const rowBusy = savingIds.has(u.user_id);
                  const perms = draft[u.user_id] ?? [];
                  return (
                    <TR
                      key={u.user_id}
                      className="hover:bg-white/[0.04] transition-colors border-b border-white/5"
                    >
                      <TD className="sticky left-0 z-10 bg-[#1a1730]/90 backdrop-blur-sm font-medium text-slate-100">
                        <div>{u.name}</div>
                      </TD>
                      <TD className="align-middle">
                        <RoleBadge role={u.role} />
                      </TD>
                      <TD className="text-xs text-slate-400 capitalize">{u.department}</TD>
                      {PERMISSION_COLUMNS.map((col) => {
                        const checked = u.is_admin ? true : perms.includes(col.id);
                        return (
                          <TD key={col.id} className="text-center">
                            <span
                              title={u.is_admin ? 'Admin has full access' : undefined}
                              className="inline-flex justify-center"
                            >
                              <input
                                type="checkbox"
                                disabled={u.is_admin || rowBusy}
                                checked={checked}
                                onChange={() => toggle(u.user_id, col.id, u.is_admin)}
                                className="rounded border-white/20 bg-[#2a2640] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                aria-label={`${col.label} for ${u.name}`}
                              />
                            </span>
                          </TD>
                        );
                      })}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>
        </Card>
      )}
    </div>
  );
}
