// src/mastra/workflows/vertical-entry/steps/research.step.ts

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { researcher } from '../../../agents/researcher';

export const briefSchema = z.object({
  vertical: z
    .string()
    .min(2)
    .describe("The industry vertical to research, e.g. 'healthcare IT outsourcing'"),
  companyDescription: z
    .string()
    .min(10)
    .describe('Brief description of the outsourcing company entering the vertical'),
});

export const researchOutputSchema = z.object({
  threadId: z.string(),
  vertical: z.string(),
  companyDescription: z.string(),
  completionSignal: z.string(),
});

export const runResearch = createStep({
  id: 'run-research',
  description:
    'Invokes the researcher agent on a fresh thread to populate working memory with structured findings',
  inputSchema: briefSchema,
  outputSchema: researchOutputSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData) throw new Error('Brief not provided');

    const agent = mastra.getAgentById(researcher.id);
    const threadId = randomUUID();
    const resourceId = 'default';

    const prompt = `
Vertical: ${inputData.vertical}
Company description: ${inputData.companyDescription}

Populate working memory with structured findings, then emit your completion signal.
    `.trim();

    const response = await agent.stream([{ role: 'user', content: prompt }], {
      memory: { thread: threadId, resource: resourceId },
      maxSteps: 25,
    });

    let completionSignal = '';
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      completionSignal += chunk;
    }

    return {
      threadId,
      vertical: inputData.vertical,
      companyDescription: inputData.companyDescription,
      completionSignal,
    };
  },
});
