import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { AppError } from '../../utils/errors';

export type ParsedPoRow = {
  po_number: string;
  vendor: string;
  total_value: number;
};

function normalizeHeader(s: string) {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}

function parseMoney(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') throw new AppError('total_value must be a number', 400);
  const normalized = value.replace(/,/g, '').trim();
  const num = Number(normalized);
  if (!Number.isFinite(num)) throw new AppError(`Invalid total_value: ${value}`, 400);
  return num;
}

function toRowFromObject(obj: Record<string, unknown>): ParsedPoRow {
  const keys = Object.keys(obj);
  const headerMap = new Map(keys.map((k) => [normalizeHeader(k), k] as const));

  const poKey = headerMap.get('poNumber') ?? headerMap.get('ponumber') ?? headerMap.get('po');
  const vendorKey = headerMap.get('vendor');
  const totalKey = headerMap.get('totalvalue') ?? headerMap.get('total_value') ?? headerMap.get('amount');

  if (!poKey || !vendorKey || !totalKey) {
    throw new AppError('Missing required columns: po_number, vendor, total_value', 400);
  }

  const po_number = String(obj[poKey] ?? '').trim();
  const vendor = String(obj[vendorKey] ?? '').trim();
  const total_value = parseMoney(obj[totalKey]);

  if (!po_number) throw new AppError('po_number cannot be empty', 400);
  if (!vendor) throw new AppError('vendor cannot be empty', 400);
  if (total_value <= 0) throw new AppError('total_value must be > 0', 400);

  return { po_number, vendor, total_value };
}

export function parsePoFile(params: { fileBuffer: Buffer; originalName: string; mimeType?: string }): ParsedPoRow[] {
  const { fileBuffer, originalName } = params;
  const lower = originalName.toLowerCase();

  if (lower.endsWith('.csv')) {
    const text = fileBuffer.toString('utf8');
    const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true, trimHeaders: true });
    if (parsed.errors?.length) {
      throw new AppError(`CSV parse error: ${parsed.errors[0]?.message ?? 'unknown error'}`, 400);
    }
    const rows = (parsed.data ?? []).filter((r: Record<string, unknown> | null | undefined) => !!r && Object.keys(r).length > 0);
    return rows.map(toRowFromObject);
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
    if (!jsonRows.length) throw new AppError('Excel file contains no rows', 400);
    return jsonRows.map(toRowFromObject);
  }

  throw new AppError('Unsupported file type. Use .csv, .xlsx, or .xls', 400);
}

