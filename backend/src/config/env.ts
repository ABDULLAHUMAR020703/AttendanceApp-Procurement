import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Approval thresholds (amounts are numeric in DB as DECIMAL, treat as JS number after parsing)
  HIGH_VALUE_THRESHOLD: z.coerce.number().positive().default(100000),

  // Storage bucket names (create buckets in Supabase manually)
  SUPABASE_STORAGE_BUCKET_DOCUMENTS: z.string().default('pr-documents'),

  // For dev convenience if the frontend hits from a single origin
  CORS_ORIGIN: z.string().optional()
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

