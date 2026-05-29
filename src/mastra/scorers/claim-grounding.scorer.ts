import { z } from 'zod';
import { createScorer } from '@mastra/core/evals';
import { model, ModelRole } from '../../modules/model';
import { extractReportText } from './extract-report-text';

export const claimGroundingScorer = createScorer({
  id: 'claim-grounding',
  description: 'Fraction of checkable factual claims in the report that carry a citation',
  judge: {
    model: model(ModelRole.Cheap)(),
    instructions:
      'You are a strict fact-checking editor reviewing a market research report for proper attribution.',
  },
})
  .analyze({
    description: 'Identify factual claims and whether each is cited',
    outputSchema: z.object({
      claims: z.array(
        z.object({
          claim: z.string(),
          isFactual: z.boolean(),
          isCited: z.boolean(),
        }),
      ),
    }),
    createPrompt: ({ run }) =>
      `
Below is a market-entry research report. Extract its individual CHECKABLE
factual claims — statements that assert a fact about the world that could be
verified against a source (market sizes, growth rates, percentages, named
companies/products/deals, regulatory facts, dates).

For each, decide:
  - isFactual: true if it's a checkable factual claim; false if it's the
    author's judgment, recommendation, or synthesis (those are EXEMPT and
    should be marked isFactual: false).
  - isCited: true if a source/citation (a URL, a "(Source: X)" reference, or a
    "[1]"-style marker) is attached to or immediately adjacent to the claim.

Do not invent claims. Only extract what is actually present.

Report:
"""
${extractReportText(run.output)}
"""
    `.trim(),
  })
  .generateScore(({ results }) => {
    const claims = results.analyzeStepResult.claims.filter((c) => c.isFactual);

    if (!claims.length) return 1;

    const cited = claims.filter((c) => c.isCited).length;

    return cited / claims.length;
  })
  .generateReason(({ results, score }) => {
    const factual = results.analyzeStepResult.claims.filter((c) => c.isFactual);
    const uncited = factual.filter((c) => !c.isCited);

    if (!factual.length) return 'No checkable factual claims found.';

    const head = `${Math.round(score * 100)}% of ${factual.length} factual claims are cited.`;

    if (!uncited.length) return `${head} All grounded.`;

    return `${head} Uncited: ${uncited
      .slice(0, 3)
      .map((c) => `"${c.claim.slice(0, 60)}…"`)
      .join('; ')}`;
  });
