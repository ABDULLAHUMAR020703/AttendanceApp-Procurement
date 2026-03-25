import { supabaseAdmin } from '../../config/supabase';

export async function writeAuditLog(params: {
  action: string;
  userId: string;
  entity: string;
  entityId: string;
}) {
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    action: params.action,
    user_id: params.userId,
    entity: params.entity,
    entity_id: params.entityId,
    timestamp: new Date().toISOString(),
  });
  if (error) throw error;
}

