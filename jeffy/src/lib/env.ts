/**
 * Runtime configuration, validated once at import so a missing value fails
 * loudly at startup instead of as a confusing network error five screens in.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in, then restart the bundler ` +
        '(EXPO_PUBLIC_* vars are inlined at build time, so a reload is not enough).',
    );
  }
  return value.trim();
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
} as const;
