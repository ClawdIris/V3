import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import {
  MODEL,
  TAGGING_EFFORT,
  anthropic,
  assertImagePayload,
  translateAnthropicError,
} from '../_shared/anthropic.ts';
import { taggedItemSchema } from '../_shared/contracts.ts';
import {
  clientForRequest,
  corsHeaders,
  handleError,
  jsonResponse,
  requireClosetMember,
  requireUser,
  HttpError,
} from '../_shared/http.ts';

/**
 * Feature 1a: identify a single photographed garment.
 *
 * The reply is always a proposal. The app shows it in an editable form and the
 * user confirms before anything is saved, so a wrong tag costs a correction
 * rather than a bad record. Confidence is returned and displayed rather than
 * hidden, so a low-confidence guess reads as a guess.
 */

const SYSTEM_PROMPT = `You identify single garments from photographs for a personal wardrobe app.

Look at the one main garment in the photo and describe it factually.

Rules:
- name: what the owner would call it in their own closet, e.g. "Navy oxford shirt",
  "Black slim jeans". Short, specific, no marketing language, no brand guesses.
- colors: the colours actually visible, most dominant first, in plain words
  ("navy", "cream", "olive"). At most three unless it is genuinely multicoloured.
- material: only if the weave or texture makes it reasonably clear. Otherwise null.
- formality: 1 gym or loungewear, 2 casual, 3 smart casual, 4 business casual,
  5 formal or black tie.
- seasons: when this would actually be comfortable to wear. A year-round item
  gets all four. Do not guess a single season for something versatile.
- confidence: your genuine confidence in the whole reading, 0 to 1. Use a low
  number freely -- a hedged answer the user corrects is far better than a
  confident wrong one.
- notes: only when something is genuinely ambiguous or worth the user checking,
  such as a colour that photographs badly. Otherwise null.

Never invent a brand, size or price. Those are not visible and are not your job.`;

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (request.method !== 'POST') {
      throw new HttpError('bad_request', 'POST only');
    }

    const { client } = clientForRequest(request);
    await requireUser(client);

    const body: unknown = await request.json().catch(() => {
      throw new HttpError('bad_request', 'Body must be JSON');
    });
    if (typeof body !== 'object' || body === null) {
      throw new HttpError('bad_request', 'Body must be an object');
    }

    const payload = body as Record<string, unknown>;

    // The body claims a closet; verify that claim against RLS rather than
    // trusting it. Tagging is cheap but it still spends the project's tokens.
    await requireClosetMember(client, payload.closet_id);

    const { base64, mediaType } = assertImagePayload(
      payload.image_base64,
      payload.image_media_type,
    );

    const response = await anthropic()
      .messages.parse({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        output_config: {
          effort: TAGGING_EFFORT,
          format: zodOutputFormat(taggedItemSchema),
        },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: 'Identify this garment.' },
            ],
          },
        ],
      })
      .catch((cause: unknown): never => {
        throw translateAnthropicError(cause);
      });

    if (response.stop_reason === 'refusal') {
      throw new HttpError('invalid_model_output', 'The model declined to describe this image.');
    }

    // parsed_output is null when the reply did not satisfy the schema. The
    // client turns this into "fill it in yourself" rather than a half-form.
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new HttpError(
        'invalid_model_output',
        'The model did not return a usable description.',
      );
    }

    return jsonResponse({ item: response.parsed_output });
  } catch (cause) {
    return handleError(cause);
  }
});
