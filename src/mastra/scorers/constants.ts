/**
 * Marker string for skipped scorer runs. Scorers prepend this to their
 * `generateReason` output so downstream dashboards can filter "didn't
 * evaluate" rows from "evaluated and scored low" rows.
 */
export const SKIPPED_REASON_PREFIX = 'SKIPPED:';

export const INCOMPLETE_MSG = `${SKIPPED_REASON_PREFIX} agent did not produce a final report.`;

export const MIN_REPORT_LENGTH = 800;
export const MIN_SECTION_HITS = 3;

/**
 * Patterns indicating a model emitted a tool call as text content instead of
 * using the function-calling protocol — Gemma-style `<|tool_call|>` template
 * tokens, Llama-style `<tool_call>...</tool_call>` XML wrappers, raw
 * `<function=...>` parameter tags.
 */
export const TOOL_CALL_LEAK_PATTERNS = [
  /<\|tool_call/i,
  /<\|im_start\|>/i,
  /<tool_call>/i,
  /<function\s*=/i,
];

export const GARBAGE_PATTERNS = [
  ...TOOL_CALL_LEAK_PATTERNS,
  /\[object Object\]/,
  /"inputMessages"\s*:/,
  /"systemMessages"\s*:/,
];

/**
 * Expected section headers in the synthesizer's final report. A report must
 * hit at least `MIN_SECTION_HITS` of these to pass the `isFinalReport` gate.
 */
export const EXPECTED_SECTION_PATTERNS = [
  /^#{1,6}\s*\d?[.)\s]*executive\s+summary/im,
  /^#{1,6}\s*\d?[.)\s]*market\s+trends/im,
  /^#{1,6}\s*\d?[.)\s]*competitor/im,
  /^#{1,6}\s*\d?[.)\s]*(candidate\s+)?icps?/im,
  /^#{1,6}\s*\d?[.)\s]*fit\s+analysis/im,
  /^#{1,6}\s*\d?[.)\s]*positioning/im,
  /^#{1,6}\s*\d?[.)\s]*confidence/im,
  /^#{1,6}\s*\d?[.)\s]*sources?\s*$/im,
];
