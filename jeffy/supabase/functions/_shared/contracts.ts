import { z } from 'zod';

/**
 * Server-side copy of the AI response contracts.
 *
 * The app has a matching copy in src/types/contracts.ts. This one is the copy
 * that is TRUSTED: the function validates the model's JSON against it before
 * replying, so a malformed or hallucinated reply becomes a clean error rather
 * than reaching the client. Keep the two in step.
 */

export const ITEM_CATEGORIES = ['top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const;
export const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const;

export const taggedItemSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(ITEM_CATEGORIES),
  subcategory: z.string().max(60).nullable(),
  colors: z.array(z.string().min(1).max(30)).max(6),
  pattern: z.string().max(40).nullable(),
  material: z.string().max(60).nullable(),
  formality: z.number().int().min(1).max(5),
  seasons: z.array(z.enum(SEASONS)).max(4),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(280).nullable(),
});

export type TaggedItem = z.infer<typeof taggedItemSchema>;

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'upstream_error'
  | 'invalid_model_output'
  | 'rate_limited'
  | 'not_configured';
