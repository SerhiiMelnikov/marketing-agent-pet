// src/mastra/workflows/vertical-entry/steps/record-research-metrics.step.ts

import { createStep } from '@mastra/core/workflows';
import { iterationStateSchema } from './prepare-research.step';
import { readResearchMemory } from '../read-memory';
import { computeResearchMetrics } from '../research-metrics';
import { logger } from '../../../../utils/logger';

const log = logger.child({ module: 'research-metrics' });

/**
 * Pass-through observability step: after the research loop, read the final
 * working memory once, compute the deterministic research-quality metrics, and
 * log them. Returns the iteration state unchanged so synthesis is unaffected.
 */
export const recordResearchMetrics = createStep({
  id: 'record-research-metrics',
  description:
    'Computes research-quality metrics (finding density, source diversity by classifier, triangulation rate, authoritative ratio) from working memory and logs them. Pass-through.',
  inputSchema: iterationStateSchema,
  outputSchema: iterationStateSchema,
  execute: async ({ inputData, runId }) => {
    const memory = await readResearchMemory(runId, 'default');
    const metrics = computeResearchMetrics(memory);

    log.info('research quality metrics', { researchMetrics: metrics });

    return inputData;
  },
});
