import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { parsePoFile } from './service';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeAuditLog } from '../auditLogs/service';

export const poRouter = Router();

poRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

poRouter.post('/upload', requireRole('admin'), upload.single('file'), async (req, res, next) => {
  try {
    const actorUserId = req.auth!.userId;
    if (!req.file) throw new AppError('Missing `file` upload field', 400);

    const rows = parsePoFile({
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    if (rows.length === 0) throw new AppError('No valid PO rows found', 400);

    const payload = rows.map((r) => ({
      po_number: r.po_number,
      vendor: r.vendor,
      total_value: r.total_value,
      remaining_value: r.total_value,
      uploaded_by: actorUserId,
    }));

    const { data: upserted, error: upErr } = await supabaseAdmin
      .from('purchase_orders')
      .upsert(payload, {
        onConflict: 'po_number',
      })
      .select('id, po_number');
    if (upErr) throw upErr;

    if (!upserted || upserted.length === 0) throw new AppError('PO upsert returned no rows', 500);

    await writeAuditLog({
      action: 'po_uploaded',
      userId: actorUserId,
      entity: 'purchase_order',
      entityId: upserted[0].id,
    });

    res.json({ ok: true, count: rows.length });
  } catch (err) {
    next(err);
  }
});

poRouter.get('/', requireRole('admin', 'pm', 'team_lead', 'finance', 'dept_head', 'gm'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, po_number, vendor, total_value, remaining_value, uploaded_by, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  res.json({ purchaseOrders: data ?? [] });
});

