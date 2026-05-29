import { createScorer } from '@mastra/core/evals';
import { extractReportText } from './extract-report-text';

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)\]】"'<>]+/g) ?? [];

  return matches.map((u) => u.replace(/[.,;]+$/, ''));
}

function splitBodyAndSources(report: string): { body: string; sources: string } {
  const match = report.match(/^#{1,6}\s*sources?\s*$/im);

  return !match || match.index === undefined
    ? { body: report, sources: '' }
    : {
        body: report.slice(0, match.index),
        sources: report.slice(match.index),
      };
}

export const citationIntegrityScorer = createScorer({
  id: 'citation-integrity',
  description:
    'Checks that every URL cited inline also appears in the Sources section, and reports orphan/unused sources',
})
  .preprocess(({ run }) => {
    const report = extractReportText(run.output);
    const { body, sources } = splitBodyAndSources(report);

    const inlineUrls = new Set(extractUrls(body));
    const sourceUrls = new Set(extractUrls(sources));

    const orphanCitations = [...inlineUrls].filter((u) => !sourceUrls.has(u));
    const unusedSources = [...sourceUrls].filter((u) => !inlineUrls.has(u));

    return {
      inlineCount: inlineUrls.size,
      sourceCount: sourceUrls.size,
      orphanCitations,
      unusedSources,
      hasSourcesSection: sources.length > 0,
    };
  })
  .generateScore(({ results }) => {
    const p = results.preprocessStepResult;

    if (!p.hasSourcesSection || p.inlineCount === 0) return 0;

    const orphanPenalty = Math.min(1, p.orphanCitations.length * 0.34);
    const unusedPenalty = Math.min(0.3, p.unusedSources.length * 0.1);

    return Math.max(0, 1 - orphanPenalty - unusedPenalty);
  })
  .generateReason(({ results, score }) => {
    const p = results.preprocessStepResult;

    if (!p.hasSourcesSection) return 'No Sources section found in the report.';
    if (p.inlineCount === 0) return 'Report makes claims but cites no sources inline.';

    const parts: string[] = [`Score ${score.toFixed(2)}.`];

    if (p.orphanCitations.length) {
      parts.push(
        `${p.orphanCitations.length} inline citation(s) not in Sources: ${p.orphanCitations.slice(0, 3).join(', ')}${p.orphanCitations.length > 3 ? '…' : ''}.`,
      );
    }
    if (p.unusedSources.length) {
      parts.push(`${p.unusedSources.length} listed source(s) never cited inline.`);
    }
    if (parts.length === 1) parts.push('Citations and Sources are consistent.');

    return parts.join(' ');
  });
