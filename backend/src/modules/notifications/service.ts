import { supabaseAdmin } from '../../config/supabase';

export async function createInAppNotification(params: {
  userId: string;
  type: string;
  message: string;
}) {
  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: params.userId,
    type: params.type,
    message: params.message,
    is_read: false,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function enqueueEmailPlaceholder(params: {
  toEmail: string;
  subject: string;
  body: string;
}) {
  const { error } = await supabaseAdmin.from('email_outbox').insert({
    to_email: params.toEmail,
    subject: params.subject,
    body: params.body,
    status: 'queued',
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getAdminUserIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('users').select('id').eq('role', 'admin');
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

export async function notifyAllAdmins(params: { type: string; message: string }) {
  const ids = await getAdminUserIds();
  for (const id of ids) {
    await createInAppNotification({
      userId: id,
      type: params.type,
      message: params.message,
    });
  }
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.email ?? null;
}

