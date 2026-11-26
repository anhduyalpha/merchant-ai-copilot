import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

const PLACEHOLDER_PATTERNS = [
  'your-project-id',
  'your-supabase-',
  'placeholder',
  'changeme',
  'example.supabase.co',
];

export function isConfiguredSecret(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;
  const lower = trimmed.toLowerCase();
  return !PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

export interface SupabaseEnvStatus {
  configured: boolean;
  urlConfigured: boolean;
  anonKeyConfigured: boolean;
  serviceRoleConfigured: boolean;
}

export function getSupabaseEnvStatus(): SupabaseEnvStatus {
  const env = process.env;
  const url = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  const urlConfigured =
    isConfiguredSecret(url) && /^https?:\/\/.+/i.test((url ?? '').trim());
  const anonKeyConfigured = isConfiguredSecret(anonKey);
  const serviceRoleConfigured = isConfiguredSecret(serviceRoleKey);

  return {
    configured: urlConfigured && serviceRoleConfigured,
    urlConfigured,
    anonKeyConfigured,
    serviceRoleConfigured,
  };
}

/**
 * Server-only Supabase admin client authenticated with SUPABASE_SERVICE_ROLE_KEY.
 * Validated lazily at call time so `next build` succeeds before runtime secrets are populated.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error('createSupabaseAdminClient() must only be called on the server.');
  }

  const status = getSupabaseEnvStatus();
  const env = process.env;
  const url = env['NEXT_PUBLIC_SUPABASE_URL']?.trim();
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY']?.trim();

  if (!status.configured || !url || !serviceRoleKey) {
    throw new SupabaseConfigError(
      'Supabase admin credentials are not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.'
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
