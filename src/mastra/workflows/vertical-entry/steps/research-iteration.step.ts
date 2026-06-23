// src/mastra/workflows/vertical-entry/steps/research-iteration.step.ts

import { createStep } from '@mastra/core/workflows';
import type { ResearchMemory } from '../../../schemas/research-memory';
import { readResearchMemory } from '../read-memory';
import { iterationStateSchema } from './prepare-research.step';
import { invokeResearcher } from './invoke-researcher';
import { corroborationDeficits } from '../corroboration';

const MIN_TRENDS = 3;
const MIN_COMPETITORS = 3;
const MIN_ICPS = 2;
const MIN_SOURCES = 5;
const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%/;

interface MemoryCounts {
  trends: number;
  competitors: number;
  icps: number;
  sources: number;
  openQuestions: number;
}

export const runResearchIteration = createStep({
  id: 'research-iteration',
  description:
    'One iteration of the research loop. Builds a prompt that restates the brief plus the current progress counts and remaining deficits, invokes the researcher on the same thread, reads working memory once after the invocation, and outputs the new deficits + counts. Loop exit, max-attempts enforcement, and success-path cache cleanup live in the dountil callback.',
  inputSchema: iterationStateSchema,
  outputSchema: iterationStateSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const prompt = buildIterationPrompt(
      inputData,
      inputData.deficits,
      inputData.memoryCounts,
    );

    const { completionSignal } = await invokeResearcher({
      mastra,
      threadId: runId,
      resourceId: 'default',
      runId,
      prompt,
    });

    const newMemory = await readResearchMemory(runId, 'default');

    const blockingDeficits = collectBlockingDeficits(newMemory);

    return {
      ...inputData,
      completionSignal,
      blockingDeficits,
      deficits: [...blockingDeficits, ...corroborationDeficits(newMemory)],
      memoryCounts: countsFromMemory(newMemory),
    };
  },
});

function countsFromMemory(m: ResearchMemory): MemoryCounts {
  return {
    trends: m.marketTrends.length,
    competitors: m.competitors.length,
    icps: m.candidateIcps.length,
    sources: m.sourcesConsulted.length,
    openQuestions: m.openQuestions.length,
  };
}

function collectBlockingDeficits(m: ResearchMemory): string[] {
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
    sourceBias: string;
  },
  deficits: string[],
  counts: MemoryCounts,
): string {
  const hasFindings =
    counts.trends + counts.competitors + counts.icps + counts.sources > 0;

  const progressBlock = hasFindings
    ? `

Your current progress in working memory:
  - marketTrends: ${counts.trends}
  - competitors: ${counts.competitors}
  - candidateIcps: ${counts.icps}
  - sourcesConsulted: ${counts.sources}
  - openQuestions: ${counts.openQuestions}`
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

${state.sourceBias}

Populate working memory with structured findings.${findingsNote} When done, emit your completion signal in exactly this shape:
\`Recorded N trends, M competitors, K ICPs, S sources, Q open questions.\`
  `.trim();
}
