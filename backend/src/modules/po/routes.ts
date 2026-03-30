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

function normalizeVendor(vendor: string) {
  return vendor.trim().toLowerCase();
}

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

    // Aggregate by normalized vendor to avoid duplicate vendor rows in incremental uploads.
    const aggregatedByVendor = new Map<string, { vendorDisplay: string; po_number: string; total_value: number; rowCount: number }>();
    for (const r of rows) {
      const key = normalizeVendor(r.vendor);
      const prev = aggregatedByVendor.get(key);
      if (prev) {
        prev.total_value += Number(r.total_value);
        prev.po_number = r.po_number; // keep latest PO number seen for this vendor batch
        prev.rowCount += 1;
      } else {
        aggregatedByVendor.set(key, {
          vendorDisplay: r.vendor.trim(),
          po_number: r.po_number,
          total_value: Number(r.total_value),
          rowCount: 1,
        });
      }
    }

    const duplicateRowsMerged = rows.length - aggregatedByVendor.size;

    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, vendor, po_number, total_value, remaining_value');
    if (existingErr) throw existingErr;

    const existingByVendor = new Map<string, { id: string; vendor: string; total_value: number; remaining_value: number }>();
    for (const row of existingRows ?? []) {
      const key = normalizeVendor(String(row.vendor ?? ''));
      if (!key) continue;
      if (!existingByVendor.has(key)) {
        existingByVendor.set(key, {
          id: row.id,
          vendor: row.vendor,
          total_value: Number(row.total_value),
          remaining_value: Number(row.remaining_value),
        });
      }
    }

    let added = 0;
    let updated = 0;
    const touchedIds: string[] = [];
    const duplicateVendorsHandled: string[] = [];

    for (const [vendorKey, item] of aggregatedByVendor.entries()) {
      const existing = existingByVendor.get(vendorKey);
      if (existing) {
        const { data: upd, error: updErr } = await supabaseAdmin
          .from('purchase_orders')
          .update({
            // Merge incremental uploads into existing vendor totals/balance.
            total_value: Number(existing.total_value) + Number(item.total_value),
            remaining_value: Number(existing.remaining_value) + Number(item.total_value),
            po_number: item.po_number,
            vendor: item.vendorDisplay,
            uploaded_by: actorUserId,
          })
          .eq('id', existing.id)
          .select('id')
          .single();
        if (updErr) throw updErr;
        updated += 1;
        if (upd?.id) touchedIds.push(upd.id);
        duplicateVendorsHandled.push(item.vendorDisplay);
      } else {
        const { data: ins, error: insErr } = await supabaseAdmin
          .from('purchase_orders')
          .insert({
            po_number: item.po_number,
            vendor: item.vendorDisplay,
            total_value: item.total_value,
            remaining_value: item.total_value,
            uploaded_by: actorUserId,
          })
          .select('id')
          .single();
        if (insErr) throw insErr;
        added += 1;
        if (ins?.id) touchedIds.push(ins.id);
      }
    }

    if (touchedIds.length === 0) throw new AppError('PO upload produced no changes', 500);

    await writeAuditLog({
      action: 'po_uploaded',
      userId: actorUserId,
      entity: 'purchase_order',
      entityId: touchedIds[0],
    });

    res.json({
      ok: true,
      added,
      updated,
      skipped: duplicateRowsMerged,
      duplicatesHandled: duplicateVendorsHandled,
    });
  } catch (err) {
    next(err);
  }
});

poRouter.get('/', requireRole('admin', 'pm', 'employee'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, po_number, vendor, total_value, remaining_value, uploaded_by, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  res.json({ purchaseOrders: data ?? [] });
});

