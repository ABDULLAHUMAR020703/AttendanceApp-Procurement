'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppLayout } from '../../../components/AppLayout';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../../components/ui/Table';
import { useAuth, type Department, type UserRole } from '../../../features/auth/AuthProvider';
import { ApiError, authedFetchWithSupabase, NoSessionError } from '../../../lib/api';

const DEPARTMENTS: Department[] = [
  'sales',
  'hr',
  'technical',
  'finance',
  'engineering',
  'management',
  'ibs',
  'power',
  'civil_works',
  'bss_wireless',
  'fixed_network',
  'warehouse',
];
const ROLES: UserRole[] = ['admin', 'pm', 'dept_head', 'employee'];

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  created_at: string;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, profile, supabase } = useAuth();
  const token = accessToken ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'users'],
    enabled: !!token && !!supabase && profile?.role === 'admin',
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const patchMutation = useMutation({
    mutationFn: async (params: { id: string; role?: UserRole; department?: Department }) => {
      const { id, role, department } = params;
      const body: { role?: UserRole; department?: Department } = {};
      if (role !== undefined) body.role = role;
      if (department !== undefined) body.department = department;
      try {
        return await authedFetchWithSupabase<{ user: UserRow }>(supabase, `/api/users/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setLocalEdits({});
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const [localEdits, setLocalEdits] = useState<Record<string, { role: UserRole; department: Department }>>({});

  if (profile && profile.role !== 'admin') {
    return (
      <AppLayout>
        <PageContainer className="space-y-4">
          <Card className="p-6 text-sm text-rose-300">Access denied.</Card>
        </PageContainer>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Users" subtitle="Assign roles and departments. Admins are always in management." />

        {isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>
        ) : error ? (
          <Card className="p-4 text-sm text-rose-300">
            {error instanceof Error ? error.message : 'Failed to load users'}
          </Card>
        ) : (
          <Card className="p-0">
            <TableWrapper className="max-h-[560px] overflow-y-auto rounded-xl border border-white/10">
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Email</TH>
                    <TH>Role</TH>
                    <TH>Department</TH>
                    <TH>Save</TH>
                  </TR>
                </THead>
                <TBody>
                  {(data?.users ?? []).map((u) => {
                    const edit = localEdits[u.id] ?? { role: u.role, department: u.department as Department };
                    return (
                      <TR key={u.id}>
                        <TD>{u.name}</TD>
                        <TD className="text-xs text-muted-foreground">{u.email}</TD>
                        <TD>
                          <select
                            className="rounded-lg border border-white/10 bg-[#2a2640] px-2 py-1 text-xs"
                            value={edit.role}
                            onChange={(e) =>
                              setLocalEdits((prev) => ({
                                ...prev,
                                [u.id]: { ...edit, role: e.target.value as UserRole },
                              }))
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </TD>
                        <TD>
                          <select
                            className="rounded-lg border border-white/10 bg-[#2a2640] px-2 py-1 text-xs capitalize"
                            value={edit.role === 'admin' ? 'management' : edit.department}
                            disabled={edit.role === 'admin'}
                            onChange={(e) =>
                              setLocalEdits((prev) => ({
                                ...prev,
                                [u.id]: { ...edit, department: e.target.value as Department },
                              }))
                            }
                          >
                            {DEPARTMENTS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </TD>
                        <TD>
                          <Button
                            type="button"
                            variant="secondary"
                            className="text-xs px-2 py-1"
                            disabled={patchMutation.isPending || (edit.role === u.role && edit.department === u.department)}
                            onClick={() => {
                              const payload: { id: string; role?: UserRole; department?: Department } = { id: u.id };
                              if (edit.role !== u.role) payload.role = edit.role;
                              if (edit.role !== 'admin' && edit.department !== u.department) {
                                payload.department = edit.department;
                              }
                              if (payload.role === undefined && payload.department === undefined) return;
                              patchMutation.mutate(payload);
                            }}
                          >
                            Save
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
          </Card>
        )}
        {patchMutation.error ? (
          <Card className="p-3 text-sm text-rose-300">
            {patchMutation.error instanceof ApiError
              ? patchMutation.error.message
              : String(patchMutation.error)}
          </Card>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}
