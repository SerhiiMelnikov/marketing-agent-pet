// src/mastra/scorers/utils/citations.ts

import { SOURCES_HEADING } from '../constants';

const REF_MARKER = /\[\d+\]/g;

/** Split a report into the body (before the Sources heading) and the Sources
 *  section (from the heading on). No heading → all body. */
export function splitBodyAndSources(report: string): { body: string; sources: string } {
  const match = report.match(SOURCES_HEADING);

  return !match || match.index === undefined
    ? { body: report, sources: '' }
    : { body: report.slice(0, match.index), sources: report.slice(match.index) };
}

export function extractRefs(text: string): Set<string> {
  return new Set(text.match(REF_MARKER) ?? []);
}

/** Inline [N] markers in the body that have no matching [N] in the Sources
 *  section (a report with no Sources section makes every inline [N] an orphan). */
export function orphanCitations(report: string): string[] {
  const { body, sources } = splitBodyAndSources(report);
  const inline = extractRefs(body);
  const inSources = extractRefs(sources);

  return [...inline].filter((r) => !inSources.has(r));
}

/** Distinct citation-format defects in the report text. Empty = clean.
 *  Mirrors the citation-format scorer's checks so both share one definition. */
export function citationFormatIssues(text: string): string[] {
  const issues: string[] = [];

  if (/【?\{?["']?source["']?\s*:/.test(text) || /【.*\{.*\}.*】/.test(text)) {
    issues.push('raw JSON/serialized citation object');
  }
  if (/[【】]/.test(text)) {
    issues.push('native 【…】 citation markers');
  }

  return issues;
}
