import { describe, it, expect } from 'vitest';
import type { ResearchMemory } from '../../schemas/research-memory';
import { computeResearchMetrics } from './research-metrics';

const mem = (o: Partial<{
  marketTrends: { claim: string; evidence: string; sourceUrl: string; publisher: string }[];
  competitors: unknown[];
  candidateIcps: unknown[];
  sourcesConsulted: { url: string; classifier: string }[];
  openQuestions: unknown[];
}>): ResearchMemory =>
  ({
    marketTrends: o.marketTrends ?? [],
    competitors: o.competitors ?? [],
    candidateIcps: o.candidateIcps ?? [],
    sourcesConsulted: o.sourcesConsulted ?? [],
    openQuestions: o.openQuestions ?? [],
  }) as unknown as ResearchMemory;

describe('computeResearchMetrics', () => {
  it('returns zeroed metrics for an empty working memory', () => {
    const m = computeResearchMetrics(mem({}));

    expect(m.findingDensity).toEqual({ trends: 0, competitors: 0, icps: 0, sources: 0, openQuestions: 0 });
    expect(m.sourceDiversityByClassifier).toEqual({});
    expect(m.distinctClassifiers).toBe(0);
    expect(m.triangulationRate).toBe(1);
    expect(m.authoritativeRatio).toBe(0);
  });

  it('counts sources by classifier and computes the authoritative ratio', () => {
    const m = computeResearchMetrics(
      mem({
        sourcesConsulted: [
          { url: 'https://a/1', classifier: 'analyst' },
          { url: 'https://v/1', classifier: 'vendor' },
          { url: 'https://g/1', classifier: 'government' },
        ],
      }),
    );

    expect(m.sourceDiversityByClassifier).toEqual({ analyst: 1, vendor: 1, government: 1 });
    expect(m.distinctClassifiers).toBe(3);
    expect(m.authoritativeRatio).toBeCloseTo(2 / 3);
  });

  it('triangulationRate is 1 when two quant trends differ in source and publisher', () => {
    const m = computeResearchMetrics(
      mem({
        marketTrends: [
          { claim: 'market is $5B', evidence: 'e1', sourceUrl: 'https://a', publisher: 'Gartner' },
          { claim: 'grows 12%', evidence: 'e2', sourceUrl: 'https://b', publisher: 'IDC' },
        ],
      }),
    );

    expect(m.triangulationRate).toBe(1);
  });

  it('triangulationRate is 0 for a lone quant trend', () => {
    const m = computeResearchMetrics(
      mem({
        marketTrends: [{ claim: 'market is $5B', evidence: 'e', sourceUrl: 'https://a', publisher: 'Gartner' }],
      }),
    );

    expect(m.triangulationRate).toBe(0);
  });

  it('triangulationRate is 1 when there are no quantitative trends', () => {
    const m = computeResearchMetrics(
      mem({
        marketTrends: [{ claim: 'qualitative shift', evidence: 'no figures', sourceUrl: 'https://a', publisher: 'X' }],
      }),
    );

    expect(m.triangulationRate).toBe(1);
  });

  it('treats a trend as quantitative when only the evidence carries a figure', () => {
    const m = computeResearchMetrics(
      mem({
        marketTrends: [
          { claim: 'adoption is rising', evidence: 'reached $2B in 2025', sourceUrl: 'https://a', publisher: 'X' },
        ],
      }),
    );

    // A lone quant trend → 0; if the evidence figure were ignored it would be 1.
    expect(m.triangulationRate).toBe(0);
  });
});
