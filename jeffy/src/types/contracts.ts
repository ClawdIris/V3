import { z } from 'zod';

import { ITEM_CATEGORIES, SEASONS } from './database';

/**
 * Contracts for everything an Edge Function returns.
 *
 * Quality bar 2: every AI call has a loading state, an error state and a
 * manual fallback. These schemas are what make the error state honest — a
 * model reply that does not parse is an error, not a half-filled form the
 * user has to notice is wrong.
 *
 * The Edge Functions validate against the same shapes before replying (see
 * supabase/functions/_shared/contracts.ts). Keep the two in step; the shared
 * copy is the one the server trusts.
 */

export const itemCategorySchema = z.enum(ITEM_CATEGORIES);
export const seasonSchema = z.enum(SEASONS);

/** Feature 1a: what vision returns for a single photographed garment. */
export const taggedItemSchema = z.object({
  name: z.string().min(1).max(80),
  category: itemCategorySchema,
  subcategory: z.string().max(60).nullable(),
  colors: z.array(z.string().min(1).max(30)).max(6),
  pattern: z.string().max(40).nullable(),
  material: z.string().max(60).nullable(),
  formality: z.number().int().min(1).max(5),
  seasons: z.array(seasonSchema).max(4),
  /** The model's own confidence, surfaced rather than hidden. */
  confidence: z.number().min(0).max(1),
  /** Populated when the model is unsure and wants the user to look. */
  notes: z.string().max(280).nullable(),
});

export type TaggedItem = z.infer<typeof taggedItemSchema>;

export const tagItemResponseSchema = z.object({
  item: taggedItemSchema,
});

export type TagItemResponse = z.infer<typeof tagItemResponseSchema>;

/** Every Edge Function returns this shape on failure. */
export const functionErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'unauthorized',
      'forbidden',
      'bad_request',
      'upstream_error',
      'invalid_model_output',
      'rate_limited',
      'not_configured',
    ]),
    message: z.string(),
  }),
});

export type FunctionErrorCode = z.infer<typeof functionErrorSchema>['error']['code'];
