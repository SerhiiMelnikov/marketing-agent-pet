// src/mastra/workflows/vertical-entry/steps/research.step.ts

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { RequestContext } from '@mastra/core/request-context';
import { researcher } from '../../../agents/researcher';
import { getProfile } from '../../../../modules/companies';
import { env } from '../../../../config/env';
import { getCache } from '../../../../modules/page-cache';
import { logger } from '../../../../utils/logger';
import { getErrMsg } from '../../../../utils/errors';

const log = logger.child({ module: 'research-step' });

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

export const researchOutputSchema = z.object({
  threadId: z.string(),
  vertical: z.string(),
  companyName: z.string(),
  companyFacts: z.string(),
  completionSignal: z.string(),
});

export const runResearch = createStep({
  id: 'run-research',
  description:
    'Invokes the researcher agent on a fresh thread to populate working memory with structured findings',
  inputSchema: briefSchema,
  outputSchema: researchOutputSchema,
  execute: async ({ inputData, mastra, runId }) => {
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

    const agent = mastra.getAgentById(researcher.id);
    const threadId = randomUUID();
    const resourceId = 'default';

    const requestContext = new RequestContext<{ runId: string }>([['runId', runId]]);

    const prompt = `
Vertical: ${inputData.vertical}
Company: ${profile.name}
Profile (verified ${profile.lastVerified}):
${profile.facts}

Populate working memory with structured findings, then emit your completion signal.
    `.trim();

    try {
      const response = await agent.stream([{ role: 'user', content: prompt }], {
        memory: { thread: threadId, resource: resourceId },
        maxSteps: 60,
        requestContext,
      });

      let completionSignal = '';
      for await (const chunk of response.textStream) {
        process.stdout.write(chunk);
        completionSignal += chunk;
      }

      return {
        threadId,
        vertical: inputData.vertical,
        companyName: profile.name,
        companyFacts: profile.facts,
        completionSignal,
      };
    } finally {
      try {
        await getCache().clear(runId);
      } catch (err) {
        log.warn(
          `Failed to clear page cache for run ${runId}: ${getErrMsg(err)} — entries will expire via TTL`,
        );
      }
    }
  },
});
