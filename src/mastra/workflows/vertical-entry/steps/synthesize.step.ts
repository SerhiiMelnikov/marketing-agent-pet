// src/mastra/workflows/vertical-entry/steps/synthesize.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { synthesizer } from '../../../agents/synthesizer';
import { iterationStateSchema } from './prepare-research.step';
import { readResearchMemory } from '../read-memory';
import { corroborationFlagBlock } from '../corroboration';

export const reportSchema = z.object({
  threadId: z.string(),
  report: z.string(),
});

export const runSynthesis = createStep({
  id: 'run-synthesis',
  description:
    'Invokes the synthesizer agent on the same thread to read working memory and write the final report',
  inputSchema: iterationStateSchema,
  outputSchema: reportSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const agent = mastra.getAgentById(synthesizer.id);

    const memory = await readResearchMemory(runId, 'default');
    const flagBlock = corroborationFlagBlock(memory);

    const prompt = `
The researcher has populated working memory with findings about:

Vertical: ${inputData.vertical}
Company: ${inputData.companyName}
Profile:
${inputData.companyFacts}

Read the working-memory document now and produce the final markdown report.${flagBlock ? `\n\n${flagBlock}` : ''}
    `.trim();

    const response = await agent.stream([{ role: 'user', content: prompt }], {
      memory: {
        thread: runId,
        resource: 'default',
        options: { readOnly: true },
      },
      maxSteps: 1,
    });

    let report = '';
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      report += chunk;
    }

    return { threadId: runId, report };
  },
});
