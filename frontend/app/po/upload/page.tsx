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

export default function PoUploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, supabase } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
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
      const json = await res.json().catch(() => ({}));
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

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="PO Upload"
          subtitle="Upload a CSV/XLSX with columns: po_number, vendor, total_value."
        />

        {role !== 'admin' && role !== 'super_admin' ? (
          <Card className="p-4 text-sm text-rose-300">
            Only admins can upload purchase orders.
          </Card>
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
              {result ? <div className="text-sm text-emerald-300">Success: {JSON.stringify(result)}</div> : null}
            </form>
          </Card>
        )}
      </PageContainer>
    </AppLayout>
  );
}

