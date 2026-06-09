// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, prepareResearch } from './steps/prepare-research.step';
import { runResearchIteration } from './steps/research-iteration.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';
import { clearCache } from './steps/cache-cleanup';

const MAX_ATTEMPTS = 3;

const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
  options: {
    onFinish: async ({ runId, status }) => {
      // Skip on 'suspended' — that's a pause, not an end; the cache must
      // stay warm for resume. This workflow doesn't currently suspend,
      // but the guard protects against silent breakage if we add it.
      if (status === 'suspended') return;
      await clearCache(runId);
    },
  },
})
  .then(prepareResearch)
  .dountil(runResearchIteration, ({ inputData, iterationCount }) => {
    if (inputData.deficits.length === 0) return Promise.resolve(true);
    if (iterationCount >= MAX_ATTEMPTS) {
      throw new Error(
        `Research insufficient after ${iterationCount} attempts:\n  - ` +
          inputData.deficits.join('\n  - '),
      );
    }
    return Promise.resolve(false);
  })
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
