import { createScorer } from '@mastra/core/evals';
import { INCOMPLETE_MSG } from './constants';
import { preprocessRun, citationFormatIssues } from './utils';

export const citationFormatScorer = createScorer({
  id: 'citation-format',
  type: 'agent',
  description: 'Penalizes raw JSON or malformed citations leaking into the report',
})
  .preprocess(({ run }) => preprocessRun(run))
  .generateScore(({ results }) => {
    const { text, isComplete } = results.preprocessStepResult;

    if (!isComplete) return 0;

    return +!citationFormatIssues(text).length;
  })
  .generateReason(({ score, results }) => {
    if (!results.preprocessStepResult.isComplete) {
      return INCOMPLETE_MSG;
    }

    return score
      ? 'Citations are clean.'
      : 'Report contains raw JSON/serialized or native (【N】) citation markers instead of clean [N] references.';
  });
