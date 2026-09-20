import { supabase } from './supabase';
import { functionErrorSchema, type FunctionErrorCode } from '@/types/contracts';
import type { z } from 'zod';

/**
 * Calling an Edge Function, with the failure modes made explicit.
 *
 * Every AI feature in Jeffy is reachable without AI — you can always type the
 * fields in yourself — so the only thing this has to do well is fail clearly
 * and quickly enough that the manual path is still appealing.
 */

export class AiError extends Error {
  readonly code: FunctionErrorCode | 'network' | 'timeout' | 'invalid_response';
  /** True when the user could reasonably tap the button again. */
  readonly retryable: boolean;

  constructor(
    code: AiError['code'],
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options === undefined ? undefined : { cause: options.cause });
    this.name = 'AiError';
    this.code = code;
    this.retryable = options?.retryable ?? DEFAULT_RETRYABLE.has(code);
  }
}

const DEFAULT_RETRYABLE = new Set<AiError['code']>([
  'network',
  'timeout',
  'upstream_error',
  'rate_limited',
  'invalid_model_output',
  'invalid_response',
]);

/** Vision calls are slow; past this the user is better served by typing. */
export const AI_TIMEOUT_MS = 45_000;

export function describeAiError(error: unknown): string {
  if (!(error instanceof AiError)) {
    return 'Something went wrong. You can fill this in yourself instead.';
  }
  switch (error.code) {
    case 'network':
      return 'No connection. Fill this in yourself, or try again when you are back online.';
    case 'timeout':
      return 'That took too long. Try again, or just fill it in yourself.';
    case 'rate_limited':
      return 'Too many requests at once. Wait a moment and try again.';
    case 'not_configured':
      return 'AI is not set up on this project yet. Fill this in yourself for now.';
    case 'unauthorized':
    case 'forbidden':
      return 'You do not have access to do that.';
    case 'invalid_model_output':
    case 'invalid_response':
      return 'The reply did not make sense. Try again, or fill it in yourself.';
    case 'bad_request':
      return 'That request was not valid.';
    case 'upstream_error':
      return 'The AI service is having trouble. Try again shortly.';
  }
}

export async function callFunction<T>(
  name: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
  timeoutMs: number = AI_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // invoke() attaches the caller's JWT, which is what lets the function
    // re-check closet membership server-side instead of trusting the body.
    const { data, error } = await supabase.functions.invoke(name, {
      body,
      signal: controller.signal,
    });

    if (error !== null) {
      if (controller.signal.aborted) {
        throw new AiError('timeout', `${name} timed out`);
      }
      // A FunctionsHttpError carries the function's own JSON body.
      const parsed = functionErrorSchema.safeParse(
        (error as { context?: unknown }).context ?? null,
      );
      if (parsed.success) {
        throw new AiError(parsed.data.error.code, parsed.data.error.message);
      }
      throw new AiError('network', error.message, { cause: error });
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new AiError('invalid_response', `${name} returned an unexpected shape`, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  } catch (cause) {
    if (cause instanceof AiError) throw cause;
    if (controller.signal.aborted) throw new AiError('timeout', `${name} timed out`);
    throw new AiError('network', 'Could not reach the server', { cause });
  } finally {
    clearTimeout(timer);
  }
}
