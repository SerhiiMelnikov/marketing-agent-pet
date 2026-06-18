// src/mastra/processors/floating-cache-breakpoint.processor.ts

import type { Processor, ProcessInputStepArgs } from '@mastra/core/processors';

const ID = 'floating-cache-breakpoint';

/**
 * Part types that carry real content to the model. A trailing `step-start`
 * (or `source-*` / `data-*`) part carries no text and would not emit a
 * `cache_control` block, so we skip past it to the last content-bearing part.
 */
const CONTENT_PART_TYPES: string[] = ['text', 'tool-invocation', 'reasoning', 'file'];

/**
 * Places exactly one moving Anthropic prompt-cache breakpoint on the tail of the
 * researcher's conversation, so the accumulated tool/search content is read from
 * cache instead of re-sent as full-price text on every step.
 *
 * Each step it first clears any breakpoint a prior step left on the conversation
 * (markers persist via memory, so leaving them would blow past Anthropic's
 * 4-breakpoint limit), then marks the last CONTENT-BEARING part of the last
 * message with ephemeral `cacheControl`. With the agent's static system-prefix
 * breakpoint that is two breakpoints total.
 *
 * Field note: at the MastraDBMessage layer the field is `providerMetadata`;
 * Mastra maps it to the core prompt's `part.providerOptions`, which the Anthropic
 * message converter reads to emit `cache_control`. Marking a trailing
 * `step-start` part emits nothing, so we skip to the last content-bearing part —
 * confirmed on the 2026-06-18 verification run (cachedInputTokens 25k → 196k).
 */
export class FloatingCacheBreakpointProcessor implements Processor<typeof ID> {
  readonly id = ID;
  readonly name = 'Floating Cache Breakpoint';

  processInputStep({ messages }: ProcessInputStepArgs): ProcessInputStepArgs['messages'] {
    // 1. Clear any breakpoint a prior step left behind.
    for (const message of messages) {
      for (const part of message.content.parts) {
        const anthropic = part.providerMetadata?.anthropic;
        if (anthropic && 'cacheControl' in anthropic) {
          delete anthropic.cacheControl;
        }
      }
    }

    // 2. Mark the last content-bearing part of the last message.
    const lastMessage = messages.at(-1);
    const parts = lastMessage?.content.parts ?? [];
    let markIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (CONTENT_PART_TYPES.includes(parts[i].type)) {
        markIdx = i;
        break;
      }
    }
    if (markIdx === -1 && parts.length > 0) {
      markIdx = parts.length - 1;
    }

    if (markIdx >= 0) {
      const target = parts[markIdx];
      target.providerMetadata = {
        ...target.providerMetadata,
        anthropic: {
          ...target.providerMetadata?.anthropic,
          cacheControl: { type: 'ephemeral' },
        },
      };
    }

    return messages;
  }
}
