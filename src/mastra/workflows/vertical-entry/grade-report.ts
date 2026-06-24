// src/mastra/workflows/vertical-entry/grade-report.ts

import { citationFormatIssues, orphanCitations } from '../../scorers/utils/citations';

export interface ReportGrade {
  passed: boolean;
  issues: string[];
}

/**
 * Structural quality gate for the synthesizer's report. Fails on fixable
 * citation defects — raw JSON/serialized citation leaks or orphan [N] markers
 * (inline citations missing from the Sources section). A listed-but-uncited
 * source is intentionally NOT a failure.
 */
export function gradeReportStructure(report: string): ReportGrade {
  const issues: string[] = [];

  const format = citationFormatIssues(report);
  if (format.length) {
    issues.push(`The report contains ${format.join(' and ')} instead of clean [N] references.`);
  }

  const orphans = orphanCitations(report);
  if (orphans.length) {
    issues.push(`Inline citations ${orphans.join(', ')} are not listed in the Sources section.`);
  }

  return { passed: issues.length === 0, issues };
}

/** Feedback block appended to the synthesizer prompt on a retry. */
export function renderRetryFeedback(issues: string[]): string {
  return [
    'Your previous draft had these citation problems — fix them and reproduce the FULL report:',
    ...issues.map((i) => `  - ${i}`),
    'Every inline [N] must have a matching numbered entry in the Sources section, and never emit raw JSON or 【…】 markers.',
  ].join('\n');
}
