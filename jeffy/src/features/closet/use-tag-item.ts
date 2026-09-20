import { useMutation } from '@tanstack/react-query';

import { AiError, callFunction } from '@/lib/ai-client';
import { toAnalysisBase64 } from '@/lib/images';
import { tagItemResponseSchema, type TaggedItem } from '@/types/contracts';

/**
 * Feature 1a: ask the model what a photographed garment is.
 *
 * Always optional. The caller renders the same editable form whether this
 * succeeds, fails, or is skipped entirely — the AI only ever pre-fills it.
 */
export function useTagItem(): {
  tag: (uri: string, closetId: string) => Promise<TaggedItem>;
  isTagging: boolean;
  error: AiError | Error | null;
  reset: () => void;
} {
  const mutation = useMutation({
    mutationFn: async ({
      uri,
      closetId,
    }: {
      uri: string;
      closetId: string;
    }): Promise<TaggedItem> => {
      const { base64, mediaType } = await toAnalysisBase64(uri);
      const response = await callFunction(
        'ai-tag-item',
        { closet_id: closetId, image_base64: base64, image_media_type: mediaType },
        tagItemResponseSchema,
      );
      return response.item;
    },
  });

  return {
    tag: (uri, closetId) => mutation.mutateAsync({ uri, closetId }),
    isTagging: mutation.isPending,
    error: mutation.error,
    reset: () => mutation.reset(),
  };
}
