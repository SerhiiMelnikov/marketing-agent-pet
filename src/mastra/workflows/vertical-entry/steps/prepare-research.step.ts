// src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { getProfile } from '../../../../modules/companies';
import { env } from '../../../../config/env';
import { resolveVerticalBias, renderSourceBias } from '../../../../modules/verticals';
import { logger } from '../../../../utils/logger';

export const briefSchema = z.object({
  vertical: z
    .string()
    .min(2)
    .describe("The industry vertical to research, e.g. 'healthcare IT outsourcing'"),
  companyKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Key identifying which company profile from src/modules/companies/ to use. Falls back to DEFAULT_COMPANY_KEY env var when omitted.',
    ),
});

/**
 * State shape that flows through the research-iteration loop.
 * dountil requires the step's input and output schemas to match, so this
 * type is reused for both. `deficits` is the list of unmet thresholds
 * after the most recent invocation — empty means the loop should exit.
 * `memoryCounts` is a snapshot of the working-memory counts after the
 * most recent invocation, used by the next iteration's progress block.
 * `completionSignal` carries the latest agent completion message for
 * downstream tracing.
 */
export const iterationStateSchema = z.object({
  vertical: z.string(),
  companyName: z.string(),
  companyFacts: z.string(),
  companyVerified: z.string(),
  sourceBias: z.string(),
  completionSignal: z.string(),
  deficits: z.array(z.string()),
  blockingDeficits: z.array(z.string()),
  memoryCounts: z.object({
    trends: z.number().int().nonnegative(),
    competitors: z.number().int().nonnegative(),
    icps: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
    openQuestions: z.number().int().nonnegative(),
  }),
});

export const prepareResearch = createStep({
  id: 'prepare-research',
  description:
    'Resolves the company profile from the brief and seeds the iteration state with empty deficits and zero memory counts. The agent thread for this run is the workflow runId; no separate thread is minted. The dountil loop runs after this step.',
  inputSchema: briefSchema,
  outputSchema: iterationStateSchema,
  execute: ({ inputData }) => {
    if (!inputData) throw new Error('Brief not provided');

    const companyKey = inputData.companyKey ?? env.DEFAULT_COMPANY_KEY;
    if (!companyKey) {
      throw new Error(
        'No companyKey in workflow input and DEFAULT_COMPANY_KEY env var is not set',
      );
    }
    const profile = getProfile(companyKey);
    if (!profile) {
      throw new Error(`Unknown companyKey: "${companyKey}"`);
    }

    const bias = resolveVerticalBias(inputData.vertical);
    if (!bias.matchedKey) {
      logger.warn(
        `No vertical config matched "${inputData.vertical}" — using generic shared source bias only.`,
      );
    }

    return Promise.resolve({
      vertical: inputData.vertical,
      companyName: profile.name,
      companyFacts: profile.facts,
      companyVerified: profile.lastVerified,
      sourceBias: renderSourceBias(bias),
      completionSignal: '',
      deficits: [],
      blockingDeficits: [],
      memoryCounts: {
        trends: 0,
        competitors: 0,
        icps: 0,
        sources: 0,
        openQuestions: 0,
      },
    });
  },
});
