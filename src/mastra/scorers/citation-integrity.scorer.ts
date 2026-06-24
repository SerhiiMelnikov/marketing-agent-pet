import { createScorer } from '@mastra/core/evals';
import { INCOMPLETE_MSG } from './constants';
import { preprocessRun, splitBodyAndSources, extractRefs, orphanCitations } from './utils';

export const citationIntegrityScorer = createScorer({
  id: 'citation-integrity',
  type: 'agent',
  description:
    'Checks that every URL cited inline also appears in the Sources section, and reports orphan/unused sources',
})
  .preprocess(({ run }) => {
    const base = preprocessRun(run);

    if (!base.isComplete) {
      return {
        isComplete: false,
        inlineCount: 0,
        sourceCount: 0,
        orphanCitations: [],
        unusedSources: [],
        hasSourcesSection: false,
      };
    }

    const { body, sources } = splitBodyAndSources(base.text);

    const inlineRefs = extractRefs(body);
    const sourceRefs = extractRefs(sources);

    const orphans = orphanCitations(base.text);
    const unusedSources = [...sourceRefs].filter((r) => !inlineRefs.has(r));

    return {
      isComplete: true,
      inlineCount: inlineRefs.size,
      sourceCount: sourceRefs.size,
      orphanCitations: orphans,
      unusedSources,
      hasSourcesSection: sources.length > 0,
    };
  })
  .generateScore(({ results }) => {
    const p = results.preprocessStepResult;

    if (!p.isComplete) return 0;
    if (!p.hasSourcesSection || p.inlineCount === 0) return 0;

    const orphanPenalty = Math.min(1, p.orphanCitations.length * 0.34);
    const unusedPenalty = Math.min(0.3, p.unusedSources.length * 0.1);

    return Math.max(0, 1 - orphanPenalty - unusedPenalty);
  })
  .generateReason(({ results, score }) => {
    const p = results.preprocessStepResult;

    if (!p.isComplete) return INCOMPLETE_MSG;
    if (!p.hasSourcesSection) return 'No Sources section found in the report.';
    if (p.inlineCount === 0) return 'Report has Sources entries but no [N] citations in the body.';

    const parts: string[] = [`Score ${score.toFixed(2)}.`];

    if (p.orphanCitations.length) {
      parts.push(
        `${p.orphanCitations.length} inline citation(s) not in Sources: ${p.orphanCitations
          .slice(0, 3)
          .join(', ')}${p.orphanCitations.length > 3 ? '…' : ''}.`,
      );
    }
    if (p.unusedSources.length) {
      parts.push(`${p.unusedSources.length} listed source(s) never cited inline.`);
    }
    if (parts.length === 1) parts.push('Citations and Sources are consistent.');

    return parts.join(' ');
  });
