// src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { researchMemory } from '../../../memory';
import {
  researchMemorySchema,
  type ResearchMemory,
} from '../../../schemas/research-memory';
import { researchOutputSchema } from './research.step';

export const validateOutputSchema = researchOutputSchema.extend({
  memory: z.unknown(),
});

const MIN_TRENDS = 3;
const MIN_COMPETITORS = 3;
const MIN_ICPS = 2;
const MIN_SOURCES = 5;
const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%|\b(19|20)\d{2}\b/;

export const validateMemory = createStep({
  id: 'validate-memory',
  description:
    'Reads working memory, parses against the schema, and fails fast if minimum thresholds for a synthesizable report are not met',
  inputSchema: researchOutputSchema,
  outputSchema: validateOutputSchema,
  execute: async ({ inputData }) => {
    const raw = await researchMemory.getWorkingMemory({
      threadId: inputData.threadId,
      resourceId: 'default',
    });

    if (!raw) {
      throw new Error(
        'Researcher produced no working memory. The synthesizer has no input — halting.',
      );
    }

    // Working memory in schema mode is stored as JSON-stringified content.
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new Error(
        `Working memory is not valid JSON. Length: ${raw.length}. Head: ${raw.slice(0, 200)}`,
      );
    }

    const parsed = researchMemorySchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(
        'Working memory does not match the expected schema: ' + parsed.error.message,
      );
    }

    const m = parsed.data;
    const deficits = collectDeficits(m);
    if (deficits.length) {
      throw new Error(
        'Research insufficient for synthesis:\n  - ' + deficits.join('\n  - '),
      );
    }

    return { ...inputData, memory: m };
  },
});

function collectDeficits(m: ResearchMemory): string[] {
  const deficits: string[] = [];

  if (m.marketTrends.length < MIN_TRENDS) {
    deficits.push(
      `marketTrends: got ${m.marketTrends.length}, need >= ${MIN_TRENDS}`,
    );
  }
  if (m.competitors.length < MIN_COMPETITORS) {
    deficits.push(
      `competitors: got ${m.competitors.length}, need >= ${MIN_COMPETITORS}`,
    );
  }
  if (m.candidateIcps.length < MIN_ICPS) {
    deficits.push(
      `candidateIcps: got ${m.candidateIcps.length}, need >= ${MIN_ICPS}`,
    );
  }
  if (m.sourcesConsulted.length < MIN_SOURCES) {
    deficits.push(
      `sourcesConsulted: got ${m.sourcesConsulted.length}, need >= ${MIN_SOURCES}`,
    );
  }

  // Triangulation: every quantitative trend needs corroboration from another
  // trend citing the same claim from a different sourceUrl OR from the
  // sourcesConsulted log sharing the publisher.
  for (const trend of m.marketTrends) {
    const looksQuantitative =
      QUANT_CLAIM_REGEX.test(trend.claim) || QUANT_CLAIM_REGEX.test(trend.evidence);
    if (!looksQuantitative) continue;

    const corroborated = m.marketTrends.some(
      (other) =>
        other !== trend &&
        other.sourceUrl !== trend.sourceUrl &&
        (other.publisher === trend.publisher ||
          QUANT_CLAIM_REGEX.test(other.claim)),
    );
    if (!corroborated) {
      deficits.push(
        `quantitative trend "${trend.claim.slice(0, 60)}…" has no second corroborating source`,
      );
    }
  }

  return deficits;
}
