import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ErrorCode } from './contracts.ts';

/**
 * Shared HTTP plumbing: CORS, typed errors, and — the important one —
 * server-side verification that the caller really is a member of the closet
 * they claim to be acting on.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  bad_request: 400,
  upstream_error: 502,
  invalid_model_output: 502,
  rate_limited: 429,
  not_configured: 503,
};

export function errorResponse(code: ErrorCode, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status: STATUS[code],
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Builds a Supabase client that acts AS THE CALLER, forwarding their JWT.
 *
 * Deliberately not the service role: every query this client makes is still
 * subject to RLS, so a function bug cannot become a data leak. The service
 * role is used only where a function must write something the user cannot
 * (the product lookup cache), and then explicitly.
 */
export function clientForRequest(request: Request): { client: SupabaseClient; jwt: string } {
  const authorization = request.headers.get('Authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    throw new HttpError('unauthorized', 'Missing bearer token');
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (url === undefined || anonKey === undefined) {
    throw new HttpError('not_configured', 'Supabase environment is not configured');
  }

  return {
    client: createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    jwt: authorization.slice('Bearer '.length),
  };
}

export async function requireUser(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error !== null || data.user === null) {
    throw new HttpError('unauthorized', 'Not signed in');
  }
  return data.user.id;
}

/**
 * Confirms the caller is an accepted member of this closet.
 *
 * The client sends closet_id in the body, and a body is not evidence. This
 * calls the same is_closet_member() the RLS policies use, so the function
 * cannot be talked into doing work on a closet the caller cannot see.
 */
export async function requireClosetMember(
  client: SupabaseClient,
  closetId: unknown,
): Promise<string> {
  if (typeof closetId !== 'string' || !UUID.test(closetId)) {
    throw new HttpError('bad_request', 'closet_id must be a uuid');
  }

  const { data, error } = await client.rpc('is_closet_member', { p_closet: closetId });
  if (error !== null) throw new HttpError('forbidden', 'Could not verify closet access');
  if (data !== true) throw new HttpError('forbidden', 'Not a member of that closet');

  return closetId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function handleError(cause: unknown): Response {
  if (cause instanceof HttpError) return errorResponse(cause.code, cause.message);
  console.error('[unhandled]', cause);
  return errorResponse('upstream_error', 'Unexpected server error');
}
