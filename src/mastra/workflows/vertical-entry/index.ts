// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, prepareResearch } from './steps/prepare-research.step';
import { runResearchIteration } from './steps/research-iteration.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';
import { recordResearchMetrics } from './steps/record-research-metrics.step';
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
    // Exit when every gap is closed (count, triangulation, and corroboration).
    if (inputData.deficits.length === 0) return Promise.resolve(true);
    if (iterationCount >= MAX_ATTEMPTS) {
      // Count/triangulation minimums are hard requirements — fail the run.
      if (inputData.blockingDeficits.length > 0) {
        throw new Error(
          `Research insufficient after ${iterationCount} attempts:\n  - ` +
            inputData.blockingDeficits.join('\n  - '),
        );
      }
      // Only corroboration gaps remain: fall through to synthesis, where the
      // surviving items are flagged under "Confidence & Gaps".
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  })
  .then(recordResearchMetrics)
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
