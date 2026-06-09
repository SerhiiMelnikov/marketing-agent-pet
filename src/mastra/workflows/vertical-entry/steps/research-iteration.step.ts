// src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts

import { createStep } from '@mastra/core/workflows';
import { researchMemory } from '../../../memory';
import {
  researchMemorySchema,
  type ResearchMemory,
} from '../../../schemas/research-memory';
import { iterationStateSchema } from './prepare-research.step';
import { invokeResearcher } from './invoke-researcher';
import { clearCache } from './cache-cleanup';

const MIN_TRENDS = 3;
const MIN_COMPETITORS = 3;
const MIN_ICPS = 2;
const MIN_SOURCES = 5;
const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%/;
const MAX_ATTEMPTS = 3;

const EMPTY_MEMORY: ResearchMemory = {
  marketTrends: [],
  competitors: [],
  candidateIcps: [],
  sourcesConsulted: [],
  openQuestions: [],
};

export const runResearchIteration = createStep({
  id: 'research-iteration',
  description:
    'One iteration of the research loop. Reads working memory, computes deficits, builds a prompt that restates the brief + accumulated progress + remaining deficits, invokes the researcher on the same thread, and returns updated state with `passed` set to true when thresholds are met.',
  inputSchema: iterationStateSchema,
  outputSchema: iterationStateSchema,
  execute: async ({ inputData, mastra, runId }) => {
    try {
      let memory: ResearchMemory = EMPTY_MEMORY;
      let deficits: string[] = [];

      // Iteration 1 (attempt=0) skips the pre-invoke read — the thread is
      // fresh, memory is definitively empty, no point in a round-trip.
      if (inputData.attempt > 0) {
        memory = await readMemory(inputData.threadId, inputData.resourceId);
        deficits = collectDeficits(memory);

        // Early exit: previous iteration's invocation filled all gaps
        if (deficits.length === 0) {
          await clearCache(runId);
          return { ...inputData, passed: true };
        }
      }

      if (inputData.attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `Research insufficient after ${inputData.attempt} attempts:\n  - ` +
            deficits.join('\n  - '),
        );
      }

      const prompt = buildIterationPrompt(inputData, memory, deficits);

      const { completionSignal } = await invokeResearcher({
        mastra,
        threadId: inputData.threadId,
        resourceId: inputData.resourceId,
        runId,
        prompt,
      });

      // Re-read AFTER invocation — null here is always a real persistence failure.
      const newMemory = await readMemory(inputData.threadId, inputData.resourceId);
      const newDeficits = collectDeficits(newMemory);
      const passed = newDeficits.length === 0;

      if (passed) {
        await clearCache(runId);
      }

      return {
        ...inputData,
        completionSignal,
        attempt: inputData.attempt + 1,
        passed,
      };
    } catch (err) {
      await clearCache(runId);
      throw err;
    }
  },
});

async function readMemory(threadId: string, resourceId: string): Promise<ResearchMemory> {
  const raw = await researchMemory.getWorkingMemory({ threadId, resourceId });

  if (!raw) {
    throw new Error(
      'Researcher invoked but produced no working memory. The persistence layer may be failing — halting.',
    );
  }

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

  return parsed.data;
}

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

  // Triangulation: every quantitative trend needs corroboration from
  // another trend citing a different sourceUrl AND a different publisher.
  for (const trend of m.marketTrends) {
    const looksQuantitative =
      QUANT_CLAIM_REGEX.test(trend.claim) || QUANT_CLAIM_REGEX.test(trend.evidence);
    if (!looksQuantitative) continue;

    const corroborated = m.marketTrends.some(
      (other) =>
        other !== trend &&
        other.sourceUrl !== trend.sourceUrl &&
        other.publisher !== trend.publisher &&
        (QUANT_CLAIM_REGEX.test(other.claim) || QUANT_CLAIM_REGEX.test(other.evidence)),
    );
    if (!corroborated) {
      deficits.push(
        `quantitative trend "${trend.claim.slice(0, 60)}…" has no second corroborating source`,
      );
    }
  }

  return deficits;
}

function buildIterationPrompt(
  state: {
    vertical: string;
    companyName: string;
    companyFacts: string;
    companyVerified: string;
  },
  memory: ResearchMemory,
  deficits: string[],
): string {
  const hasFindings =
    memory.marketTrends.length +
      memory.competitors.length +
      memory.candidateIcps.length +
      memory.sourcesConsulted.length >
    0;

  const progressBlock = hasFindings
    ? `

Your current progress in working memory:
  - marketTrends: ${memory.marketTrends.length}
  - competitors: ${memory.competitors.length}
  - candidateIcps: ${memory.candidateIcps.length}
  - sourcesConsulted: ${memory.sourcesConsulted.length}
  - openQuestions: ${memory.openQuestions.length}`
    : '';

  const deficitsBlock = deficits.length
    ? `

Address these gaps:
${deficits.map((d) => `  - ${d}`).join('\n')}`
    : '';

  const findingsNote = hasFindings
    ? ' Your existing findings persist in working memory — only fill in the gaps above.'
    : '';

  return `
Vertical: ${state.vertical}
Company: ${state.companyName}
Profile (verified ${state.companyVerified}):
${state.companyFacts}
${progressBlock}${deficitsBlock}

Populate working memory with structured findings.${findingsNote} When done, emit your completion signal in exactly this shape:
\`Recorded N trends, M competitors, K ICPs, S sources, Q open questions.\`
  `.trim();
}
