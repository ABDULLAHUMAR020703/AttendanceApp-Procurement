/**
 * Export public.users (+ optional department labels + optional dev passwords from seedUsers.sql)
 * to a CSV for handoff / audits.
 *
 * Usage (from repo root or backend/):
 *   npx tsx scripts/exportEmployeesCsv.ts
 *   npx tsx scripts/exportEmployeesCsv.ts --out ./employees.csv
 *   npx tsx scripts/exportEmployeesCsv.ts --include-seed-passwords
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as backend .env)
 *
 * Security:
 * - Real passwords are NOT stored in public.users; Supabase Auth keeps bcrypt hashes only.
 * - Plaintext passwords cannot be recovered from the API.
 * - --include-seed-passwords reads backend/supabase/seedUsers.sql VALUES tuples (dev seed only).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config();
import { z } from 'zod';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

function parseArgs(argv: string[]) {
  let out = path.join(process.cwd(), 'employees_export.csv');
  let includeSeedPasswords = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' && argv[i + 1]) {
      out = path.resolve(argv[++i]);
      continue;
    }
    if (a === '--include-seed-passwords') {
      includeSeedPasswords = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      console.log(`Usage: npx tsx scripts/exportEmployeesCsv.ts [--out path] [--include-seed-passwords]`);
      process.exit(0);
    }
  }
  return { out, includeSeedPasswords };
}

/** Parse seedUsers.sql (username, plain_password, raw_role) rows — dev seed file only. */
function loadSeedPasswordsByEmail(repoRelativeSeedPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const seedPath = path.resolve(__dirname, '..', repoRelativeSeedPath);
  if (!fs.existsSync(seedPath)) {
    console.warn(`[exportEmployeesCsv] No seed file at ${seedPath}; seed_password column will be empty.`);
    return map;
  }
  const text = fs.readFileSync(seedPath, 'utf8');
  // Matches: ('user.name', 'password123', 'super_admin'),
  const rowRe = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const [, username, plainPassword] = m;
    const email = `${username}@hadir.ai`.toLowerCase();
    map.set(email, plainPassword);
  }
  if (map.size === 0) {
    console.warn('[exportEmployeesCsv] No password tuples parsed from seed file (format may have changed).');
  }
  return map;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

async function main() {
  const { out, includeSeedPasswords } = parseArgs(process.argv);
  const env = EnvSchema.parse(process.env);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const seedPasswords = includeSeedPasswords ? loadSeedPasswordsByEmail('supabase/seedUsers.sql') : new Map<string, string>();

  const [{ data: users, error: uErr }, { data: depts, error: dErr }] = await Promise.all([
    supabase.from('users').select('id,name,email,role,department,job_title,created_at').order('email', { ascending: true }),
    supabase.from('departments').select('code,display_name'),
  ]);

  if (uErr) {
    console.error('exportEmployeesCsv: failed to load users', uErr);
    process.exit(1);
  }
  if (dErr) {
    console.warn('exportEmployeesCsv: departments load failed (department_name will be blank)', dErr);
  }

  const deptName = new Map<string, string>();
  for (const r of depts ?? []) {
    if (r.code) deptName.set(String(r.code), String(r.display_name ?? ''));
  }

  const header = [
    'id',
    'name',
    'email',
    'role',
    'department_code',
    'department_display_name',
    'job_title',
    'created_at',
    'seed_password_dev_only',
    'password_note',
  ];

  const lines: string[] = [header.map(csvEscape).join(',')];

  for (const u of users ?? []) {
    const email = String(u.email ?? '').toLowerCase();
    const seedPw = seedPasswords.get(email) ?? '';
    const passwordNote = includeSeedPasswords
      ? seedPw
        ? 'If present: from seedUsers.sql — dev/local only; rotate for production.'
        : 'No matching row in seedUsers.sql — use password reset or your own records.'
      : 'Not exported. Use --include-seed-passwords for dev seed file only, or password reset. Auth stores bcrypt only.';

    const row = [
      String(u.id ?? ''),
      String(u.name ?? ''),
      String(u.email ?? ''),
      String(u.role ?? ''),
      String(u.department ?? ''),
      deptName.get(String(u.department ?? '')) ?? '',
      String((u as { job_title?: string }).job_title ?? ''),
      String(u.created_at ?? ''),
      seedPw,
      passwordNote,
    ];
    lines.push(row.map(csvEscape).join(','));
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '\ufeff' + lines.join('\r\n'), 'utf8');
  console.info(`exportEmployeesCsv: wrote ${users?.length ?? 0} rows → ${out}`);
  if (!includeSeedPasswords) {
    console.info('exportEmployeesCsv: run with --include-seed-passwords to fill dev passwords from seedUsers.sql (if emails match).');
  }
}

main().catch((e) => {
  console.error('exportEmployeesCsv:', e);
  process.exit(1);
});
