// src/mastra/processors/floating-cache-breakpoint.processor.ts

import type { Processor, ProcessInputStepArgs } from '@mastra/core/processors';

const ID = 'floating-cache-breakpoint';

/**
 * Places exactly one moving Anthropic prompt-cache breakpoint on the tail of the
 * researcher's conversation, so the accumulated tool/search content is read from
 * cache instead of re-sent as full-price text on every step.
 *
 * Each step it first clears any breakpoint a prior step left on the conversation
 * (markers persist via memory, so leaving them would blow past Anthropic's
 * 4-breakpoint limit), then marks the last part of the last message with
 * ephemeral `cacheControl`. With the agent's static system-prefix breakpoint
 * that is two breakpoints total.
 *
 * Field note: at the MastraDBMessage layer the field is `providerMetadata`;
 * Mastra maps it to the core prompt's `part.providerOptions`, which the Anthropic
 * message converter reads to emit `cache_control`.
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

    // 2. Place one moving breakpoint on the last part of the last message.
    const lastPart = messages.at(-1)?.content.parts.at(-1);
    if (lastPart) {
      lastPart.providerMetadata = {
        ...lastPart.providerMetadata,
        anthropic: {
          ...lastPart.providerMetadata?.anthropic,
          cacheControl: { type: 'ephemeral' },
        },
      };
    }

    return messages;
  }
}
