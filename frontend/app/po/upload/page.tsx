'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../../components/AppLayout';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useAuth } from '../../../features/auth/AuthProvider';
import { getAccessTokenFromSupabaseSession, NoSessionError } from '../../../lib/api';

type UploadResult = {
  ok?: boolean;
  mode?: string;
  totalRows?: number;
  inserted?: number;
  updated?: number;
  failed?: number;
  skipped?: number;
  duplicatesHandled?: string[];
};

export default function PoUploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, supabase } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file) {
      setError('Please select a CSV/XLSX file.');
      return;
    }
    setLoading(true);
    try {
      let bearer: string;
      try {
        bearer = await getAccessTokenFromSupabaseSession(supabase);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
      const apiBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${apiBase}/api/po/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as UploadResult & { message?: string };
      if (!res.ok) throw new Error(json.message ?? 'Upload failed');
      setResult(json);
      await queryClient.invalidateQueries({ queryKey: ['po'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const role = profile?.role;
  const canUpload = role === 'admin' || role === 'pm' || role === 'dept_head';

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="PO Upload"
          subtitle="Line items: PO, Item Code, Description, Unit Price, PO Amount, PO+LINE+SN (CSV/XLSX). Admins may also use legacy columns: po_number, vendor, total_value."
        />

        {!canUpload ? (
          <Card className="p-4 text-sm text-rose-300">Only admins and PMs can upload purchase orders.</Card>
        ) : (
          <Card className="p-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium">Select File</label>
                <Input
                  className="file:mr-4 file:rounded-lg file:border-0 file:bg-purple-600 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-purple-700"
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? 'Uploading...' : 'Upload'}
              </Button>

              {error ? <div className="text-sm text-rose-300">{error}</div> : null}

              {result?.ok ? (
                <Card className="p-4 mt-2 border border-emerald-500/30 bg-emerald-950/20 space-y-2">
                  <div className="text-sm font-medium text-emerald-200">Upload summary</div>
                  <ul className="text-sm text-slate-200 space-y-1 list-disc pl-5">
                    <li>Total rows: {result.totalRows ?? '—'}</li>
                    <li>Inserted: {result.inserted ?? 0}</li>
                    <li>Updated: {result.updated ?? 0}</li>
                    <li>Failed: {result.failed ?? 0}</li>
                    {result.mode === 'legacy_vendor' && result.skipped != null ? (
                      <li>Vendor merge (extra rows): {result.skipped}</li>
                    ) : null}
                  </ul>
                  {result.mode === 'legacy_vendor' && result.duplicatesHandled && result.duplicatesHandled.length > 0 ? (
                    <div className="text-xs text-slate-400">Vendors merged: {result.duplicatesHandled.join(', ')}</div>
                  ) : null}
                </Card>
              ) : null}
            </form>
          </Card>
        )}
      </PageContainer>
    </AppLayout>
  );
}
