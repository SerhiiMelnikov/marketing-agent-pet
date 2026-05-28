import { z } from 'zod';

/**
 * Mastra's built-in `openrouter` gateway accepts model IDs in the form
 * `openrouter/<provider>/<model>` (e.g. `openrouter/anthropic/claude-opus-4.7`).
 */
export type OpenRouterModel = `openrouter/${string}/${string}`;

export const openRouterModelSchema = z
  .string()
  .regex(/^openrouter\/[^/]+\/[^/].*$/, {
    message: 'must look like "openrouter/<provider>/<model>"',
  })
  .transform((value) => value as OpenRouterModel);
