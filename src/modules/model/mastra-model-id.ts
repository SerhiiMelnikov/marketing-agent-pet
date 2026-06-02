import { z } from 'zod';
import { MODEL_EXPR } from './constants';
import { MastraModelId } from './types';

export const mastraModelIdSchema = z
  .string()
  .regex(MODEL_EXPR, { message: 'must look like "<provider>/<model>"' })
  .transform((value) => value as MastraModelId);

/**
 * Comma-separated list of model ids, used by env vars like
 * `MODEL_RESEARCHER_POOL=openai/gpt-5-mini,google/gemini-2.5-flash`.
 *
 * Empty / unset → `undefined`. Otherwise returns a non-empty array of
 * validated `MastraModelId`s. Invalid entries fail env parsing at boot.
 */
export const mastraModelIdPoolSchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;

    const items = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!items.length) return undefined;

    const parsed: MastraModelId[] = [];

    for (const item of items) {
      const result = mastraModelIdSchema.safeParse(item);

      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          message: `pool entry "${item}" is not a valid model id (expected "<provider>/<model>")`,
        });

        return z.NEVER;
      }

      parsed.push(result.data);
    }

    return parsed;
  });
