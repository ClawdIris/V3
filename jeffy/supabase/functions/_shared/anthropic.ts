import Anthropic from '@anthropic-ai/sdk';

import { HttpError } from './http.ts';

/**
 * Anthropic client for the Edge Functions.
 *
 * The key never leaves the server. Set it with:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 */

export const MODEL = 'claude-opus-5';

/**
 * Vision tagging is a short, well-specified extraction, so it does not need
 * deep reasoning. Effort `low` keeps latency and cost down; raise it if tag
 * quality proves disappointing in real use.
 */
export const TAGGING_EFFORT = 'low' as const;

export function anthropic(): Anthropic {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new HttpError(
      'not_configured',
      'ANTHROPIC_API_KEY is not set on this project. AI features are unavailable; ' +
        'the app falls back to manual entry.',
    );
  }
  return new Anthropic({ apiKey });
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Rejects anything that is not a plain base64 payload of a supported image. */
export function assertImagePayload(
  base64: unknown,
  mediaType: unknown,
): { base64: string; mediaType: ImageMediaType } {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new HttpError('bad_request', 'image_base64 is required');
  }
  // Roughly 8 MB of decoded image; the client already downscales to 1600px.
  if (base64.length > 11_000_000) {
    throw new HttpError('bad_request', 'Image is too large');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new HttpError('bad_request', 'image_base64 must be bare base64 with no data: prefix');
  }
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') {
    throw new HttpError('bad_request', 'Unsupported image media type');
  }
  return { base64, mediaType };
}

export function translateAnthropicError(cause: unknown): HttpError {
  if (cause instanceof Anthropic.RateLimitError) {
    return new HttpError('rate_limited', 'The AI service is busy. Try again shortly.');
  }
  if (cause instanceof Anthropic.AuthenticationError) {
    return new HttpError('not_configured', 'The Anthropic API key was rejected.');
  }
  if (cause instanceof Anthropic.APIError) {
    return new HttpError('upstream_error', `Anthropic error ${cause.status ?? ''}`.trim());
  }
  return new HttpError('upstream_error', 'The AI service could not be reached.');
}
