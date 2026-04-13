'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../ui/Table';
import { ApiError, authedFetchWithSupabase, authedFetchWithSupabaseNoContent, NoSessionError } from '@/lib/api';
import type { SupabaseClient } from '@supabase/supabase-js';

export type DepartmentListRow = {
  code: string;
  display_name: string;
  employee_count: number;
  project_count: number;
};

type Props = {
  supabase: SupabaseClient | null;
};

export function DepartmentsSettingsPanel({ supabase }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DepartmentListRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DepartmentListRow | null>(null);
  const [addName, setAddName] = useState('');
  const [renameName, setRenameName] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['departments'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ departments: DepartmentListRow[] }>(supabase!, '/api/departments');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: async (display_name: string) => {
      return authedFetchWithSupabase<{ department: DepartmentListRow }>(supabase!, '/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department created');
      setAddOpen(false);
      setAddName('');
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create department');
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ code, display_name }: { code: string; display_name: string }) => {
      return authedFetchWithSupabase<{ department: { code: string; display_name: string } }>(
        supabase!,
        `/api/departments/${encodeURIComponent(code)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name }),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department updated');
      setRenameTarget(null);
      setRenameName('');
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to rename department');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (code: string) => {
      await authedFetchWithSupabaseNoContent(supabase!, `/api/departments/${encodeURIComponent(code)}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department deleted');
      setDeleteTarget(null);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete department');
    },
  });

  const rows = data?.departments ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Departments management</h2>
          <p className="text-xs text-slate-400 mt-1">Rename updates the name everywhere. Delete is only allowed with zero employees and projects.</p>
        </div>
        <Button
          type="button"
          className="gap-2 shrink-0 shadow-[0_0_20px_rgba(147,51,234,0.2)] hover:shadow-[0_0_28px_rgba(147,51,234,0.35)] transition-shadow"
          onClick={() => {
            setAddName('');
            setAddOpen(true);
          }}
        >
          <Plus className="w-4 h-4" aria-hidden />
          Add department
        </Button>
      </div>

      {isLoading ? (
        <Card className="p-4 text-sm text-muted-foreground">Loading departments…</Card>
      ) : error ? (
        <Card className="p-4 text-sm text-rose-300">
          {error instanceof Error ? error.message : 'Failed to load departments'}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden border border-white/10">
          <TableWrapper className="max-h-[min(560px,70vh)] overflow-y-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Department name</TH>
                  <TH>Employees</TH>
                  <TH className="w-40 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TR>
                    <TD colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                      No departments found.
                    </TD>
                  </TR>
                ) : (
                  rows.map((d) => (
                    <TR key={d.code} className="hover:bg-white/[0.03] transition-colors">
                      <TD>
                        <div className="font-medium text-slate-100">{d.display_name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">{d.code}</div>
                      </TD>
                      <TD className="tabular-nums text-slate-300">{d.employee_count}</TD>
                      <TD className="text-right">
                        <div className="inline-flex gap-1 justify-end">
                          <Button
                            type="button"
                            variant="secondary"
                            className="p-2 rounded-lg border-purple-500/20 hover:border-purple-500/50 hover:bg-purple-500/10"
                            title="Rename"
                            onClick={() => {
                              setRenameTarget(d);
                              setRenameName(d.display_name);
                            }}
                          >
                            <Pencil className="w-4 h-4 text-purple-200" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="p-2 rounded-lg border-rose-500/20 hover:border-rose-500/50 hover:bg-rose-500/10"
                            title="Delete"
                            onClick={() => setDeleteTarget(d)}
                          >
                            <Trash2 className="w-4 h-4 text-rose-300" aria-hidden />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrapper>
        </Card>
      )}

      <Modal open={addOpen} onClose={() => !createMutation.isPending && setAddOpen(false)} title="Add department">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = addName.trim();
            if (!name) {
              toast.error('Department name is required');
              return;
            }
            createMutation.mutate(name);
          }}
        >
          <label className="block text-sm text-slate-300">
            Name
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500/70"
              placeholder="e.g. Field Operations"
              autoFocus
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={createMutation.isPending} onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={renameTarget != null}
        onClose={() => !renameMutation.isPending && setRenameTarget(null)}
        title="Rename department"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!renameTarget) return;
            const name = renameName.trim();
            if (!name) {
              toast.error('Name is required');
              return;
            }
            renameMutation.mutate({ code: renameTarget.code, display_name: name });
          }}
        >
          <p className="text-xs text-slate-400">
            Code <span className="font-mono text-purple-200/90">{renameTarget?.code}</span> stays the same; all users and projects keep the same assignment.
          </p>
          <label className="block text-sm text-slate-300">
            Display name
            <input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500/70"
              autoFocus
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={renameMutation.isPending} onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={renameMutation.isPending}>
              {renameMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteTarget != null} onClose={() => !deleteMutation.isPending && setDeleteTarget(null)} title="Delete department">
        {deleteTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              You are about to delete <span className="font-semibold text-white">{deleteTarget.display_name}</span> (
              <span className="font-mono text-xs text-purple-300">{deleteTarget.code}</span>).
            </p>
            <ul className="text-sm text-slate-400 space-y-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <li>
                Employees in this department:{' '}
                <span className="tabular-nums text-slate-200 font-medium">{deleteTarget.employee_count}</span>
              </li>
              <li>
                Projects in this department:{' '}
                <span className="tabular-nums text-slate-200 font-medium">{deleteTarget.project_count}</span>
              </li>
            </ul>
            {deleteTarget.employee_count > 0 ? (
              <p className="text-sm text-amber-200/90">
                Reassign all employees to another department before deleting.
              </p>
            ) : null}
            {deleteTarget.project_count > 0 ? (
              <p className="text-sm text-amber-200/90">Archive or move projects to another department before deleting.</p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" disabled={deleteMutation.isPending} onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={
                  deleteMutation.isPending || deleteTarget.employee_count > 0 || deleteTarget.project_count > 0
                }
                onClick={() => deleteMutation.mutate(deleteTarget.code)}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
