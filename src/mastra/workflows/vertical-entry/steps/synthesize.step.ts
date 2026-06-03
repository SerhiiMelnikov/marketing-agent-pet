// src/mastra/workflows/vertical-entry/steps/synthesize.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { synthesizer } from '../../../agents/synthesizer';
import { validateOutputSchema } from './validate-memory.step';

export const reportSchema = z.object({
  threadId: z.string(),
  report: z.string(),
});

export const runSynthesis = createStep({
  id: 'run-synthesis',
  description:
    'Invokes the synthesizer agent on the same thread to read working memory and write the final report',
  inputSchema: validateOutputSchema,
  outputSchema: reportSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgentById(synthesizer.id);

    const prompt = `
The researcher has populated working memory with findings about:

Vertical: ${inputData.vertical}
Company description: ${inputData.companyDescription}

Read the working-memory document now and produce the final markdown report.
    `.trim();

    const response = await agent.stream([{ role: 'user', content: prompt }], {
      memory: { thread: inputData.threadId, resource: 'default' },
      maxSteps: 1,
    });

    let report = '';
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      report += chunk;
    }

    return { threadId: inputData.threadId, report };
  },
});
