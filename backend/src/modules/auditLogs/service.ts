import { supabaseAdmin } from '../../config/supabase';

export type AuditLogInsert = {
  action: string;
  userId: string;
  entity: string;
  entityId: string;
  /** Defaults to `entity` when omitted (normalized type key, e.g. purchase_request). */
  entityType?: string;
  reason?: string;
  /** Optional before/after or field-level JSON. */
  changes?: Record<string, unknown> | null;
};

export async function writeAuditLog(params: AuditLogInsert) {
  const entityType = params.entityType ?? params.entity;
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    action: params.action,
    user_id: params.userId,
    entity: params.entity,
    entity_type: entityType,
    entity_id: params.entityId,
    reason: params.reason ?? null,
    changes: params.changes ?? null,
    timestamp: new Date().toISOString(),
  });
  if (error) throw error;
}
