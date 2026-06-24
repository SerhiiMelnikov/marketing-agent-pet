// src/mastra/workflows/vertical-entry/steps/synthesize.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { synthesizer } from '../../../agents/synthesizer';
import { iterationStateSchema } from './prepare-research.step';
import { readResearchMemory } from '../read-memory';
import { corroborationFlagBlock } from '../corroboration';
import { normalizeCitations } from '../normalize-citations';
import { gradeReportStructure, renderRetryFeedback } from '../grade-report';
import { logger } from '../../../../utils/logger';

export const reportSchema = z.object({
  threadId: z.string(),
  report: z.string(),
});

const MAX_SYNTH_ATTEMPTS = 3; // 1 initial + 2 retries on structural citation defects

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

    const basePrompt = `
The researcher has populated working memory with findings about:

Vertical: ${inputData.vertical}
Company: ${inputData.companyName}
Profile:
${inputData.companyFacts}

Read the working-memory document now and produce the final markdown report.${flagBlock ? `\n\n${flagBlock}` : ''}
    `.trim();

    let report = '';
    let feedback = '';

    for (let attempt = 1; attempt <= MAX_SYNTH_ATTEMPTS; attempt++) {
      const prompt = feedback ? `${basePrompt}\n\n${feedback}` : basePrompt;

      const response = await agent.stream([{ role: 'user', content: prompt }], {
        memory: {
          thread: runId,
          resource: 'default',
          // The synthesizer must be grounded ONLY in working memory (the typed
          // contract between agents), not the researcher's raw message history.
          // The default `lastMessages: 10` was loading ~131k tokens of the
          // researcher's search/fetch transcript into this prompt — bloating
          // cost (~$0.49 of wasted cacheWrite per run) and starving the model
          // into a near-empty report (8 output tokens, finishReason "stop").
          // `false` disables conversation-history loading; working memory is
          // injected by its own input processor and is unaffected.
          options: { readOnly: true, lastMessages: false },
        },
        maxSteps: 1,
      });

      let draft = '';
      for await (const chunk of response.textStream) {
        process.stdout.write(chunk);
        draft += chunk;
      }
      report = normalizeCitations(draft);

      const grade = gradeReportStructure(report);
      if (grade.passed) break;

      if (attempt === MAX_SYNTH_ATTEMPTS) {
        logger.warn(
          `Synthesis structural defects persisted after ${MAX_SYNTH_ATTEMPTS} attempts: ${grade.issues.join(' ')}`,
        );
        break;
      }

      feedback = renderRetryFeedback(grade.issues);
    }

    return { threadId: runId, report };
  },
});
