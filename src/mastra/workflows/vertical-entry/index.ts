// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, runResearch } from './steps/research.step';
import { validateMemory } from './steps/validate-memory.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';

const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
})
  .then(runResearch)
  .then(validateMemory)
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
