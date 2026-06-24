// src/mastra/workflows/vertical-entry/research-metrics.ts

import type { ResearchMemory } from '../../schemas/research-memory';

const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%/;
const NON_AUTHORITATIVE = new Set(['vendor', 'other']);

export interface ResearchMetrics {
  findingDensity: {
    trends: number;
    competitors: number;
    icps: number;
    sources: number;
    openQuestions: number;
  };
  /** classifier value → number of sourcesConsulted with it (only present classifiers). */
  sourceDiversityByClassifier: Record<string, number>;
  distinctClassifiers: number;
  /** Fraction of quantitative trends corroborated by another quantitative trend
   *  at a different sourceUrl AND publisher. 1 when there are no quant trends. */
  triangulationRate: number;
  /** Fraction of sourcesConsulted whose classifier is not vendor/other. 0 when no sources. */
  authoritativeRatio: number;
}

export function computeResearchMetrics(memory: ResearchMemory): ResearchMetrics {
  const findingDensity = {
    trends: memory.marketTrends.length,
    competitors: memory.competitors.length,
    icps: memory.candidateIcps.length,
    sources: memory.sourcesConsulted.length,
    openQuestions: memory.openQuestions.length,
  };

  const sourceDiversityByClassifier: Record<string, number> = {};
  for (const s of memory.sourcesConsulted) {
    sourceDiversityByClassifier[s.classifier] = (sourceDiversityByClassifier[s.classifier] ?? 0) + 1;
  }
  const distinctClassifiers = Object.keys(sourceDiversityByClassifier).length;

  const authoritativeCount = memory.sourcesConsulted.filter(
    (s) => !NON_AUTHORITATIVE.has(s.classifier),
  ).length;
  const authoritativeRatio = memory.sourcesConsulted.length
    ? authoritativeCount / memory.sourcesConsulted.length
    : 0;

  const isQuant = (t: { claim: string; evidence: string }) =>
    QUANT_CLAIM_REGEX.test(t.claim) || QUANT_CLAIM_REGEX.test(t.evidence);
  const quantTrends = memory.marketTrends.filter(isQuant);
  const triangulated = quantTrends.filter((t) =>
    quantTrends.some(
      (other) => other !== t && other.sourceUrl !== t.sourceUrl && other.publisher !== t.publisher,
    ),
  ).length;
  const triangulationRate = quantTrends.length ? triangulated / quantTrends.length : 1;

  return {
    findingDensity,
    sourceDiversityByClassifier,
    distinctClassifiers,
    triangulationRate,
    authoritativeRatio,
  };
}
