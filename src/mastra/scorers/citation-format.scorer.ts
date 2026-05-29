import { createScorer } from '@mastra/core/evals';
import { extractReportText } from './extract-report-text';

export const citationFormatScorer = createScorer({
  id: 'citation-format',
  description: 'Penalizes raw JSON or malformed citations leaking into the report',
})
  .generateScore(({ run }) => {
    const output = extractReportText(run.output);
    const jsonCitationLeak = /【?\{?["']?source["']?\s*:/.test(output);
    const rawBracketObjects = /【.*\{.*\}.*】/.test(output);

    return +!(jsonCitationLeak || rawBracketObjects);
  })
  .generateReason(({ score }) =>
    score
      ? 'Citations are clean.'
      : 'Report contains raw JSON/serialized citations instead of clean references.',
  );
