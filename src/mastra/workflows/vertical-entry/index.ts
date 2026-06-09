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
})
  .then(prepareResearch)
  .dountil(runResearchIteration, async ({ inputData, runId, iterationCount }) => {
    if (inputData.deficits.length === 0) {
      await clearCache(runId);
      return true;
    }
    if (iterationCount >= MAX_ATTEMPTS) {
      await clearCache(runId);
      throw new Error(
        `Research insufficient after ${iterationCount} attempts:\n  - ` +
          inputData.deficits.join('\n  - '),
      );
    }
    return false;
  })
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
