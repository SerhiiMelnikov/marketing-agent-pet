import { createScorer } from '@mastra/core/evals';
import { INCOMPLETE_MSG } from './constants';
import { preprocessRun } from './utils';

export const citationFormatScorer = createScorer({
  id: 'citation-format',
  type: 'agent',
  description: 'Penalizes raw JSON or malformed citations leaking into the report',
})
  .preprocess(({ run }) => preprocessRun(run))
  .generateScore(({ results }) => {
    const { text, isComplete } = results.preprocessStepResult;

    if (!isComplete) return 0;

    const jsonCitationLeak = /【?\{?["']?source["']?\s*:/.test(text);
    const rawBracketObjects = /【.*\{.*\}.*】/.test(text);
    // Native model citation markers (`【1†Source】`, `【1】`) instead of `[N]`.
    const nativeCitationMarker = /[【】]/.test(text);

    return +!(jsonCitationLeak || rawBracketObjects || nativeCitationMarker);
  })
  .generateReason(({ score, results }) => {
    if (!results.preprocessStepResult.isComplete) {
      return INCOMPLETE_MSG;
    }

    return score
      ? 'Citations are clean.'
      : 'Report contains raw JSON/serialized or native (【N】) citation markers instead of clean [N] references.';
  });
