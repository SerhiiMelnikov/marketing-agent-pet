import type { MastraDBMessage, MastraMessagePart } from '@mastra/core/agent';
import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';
import type { ScorerPreprocessBase } from '../types';
import {
  EXPECTED_SECTION_PATTERNS,
  GARBAGE_PATTERNS,
  MIN_REPORT_LENGTH,
  MIN_SECTION_HITS,
  TOOL_CALL_LEAK_PATTERNS,
} from '../constants';

function textFromParts(parts: MastraMessagePart[]) {
  let out = '';

  for (const part of parts) {
    if (part.type === 'text') out += part.text;
  }

  return out;
}

function extractMessageText(message: MastraDBMessage) {
  const { content: flat, parts } = message.content;

  return typeof flat === 'string' && flat.length ? flat : textFromParts(parts);
}

/**
 * Concatenate the user-visible text of a Mastra DB message list. Mastra
 * populates `content.content` (the AI SDK v4 flat string) on real outputs,
 * so prefer that when present; fall back to walking `content.parts` and
 * picking out `text` parts for shapes where only the parts array is filled.
 * Other part types (tool invocations, step starts, sources, reasoning) are
 * dropped — scorers evaluate the final response, not the trajectory.
 */
export const extractReportText = (messages: MastraDBMessage[] | undefined) =>
  messages?.map(extractMessageText).filter(Boolean).join('\n\n') ?? '';

/**
 * Shared per-run preprocessing for scorers.
 *
 * Mastra has no cross-scorer hook — each scorer's `.preprocess` step runs
 * independently. But within one agent invocation, every scorer receives the
 * SAME `run.input` and `run.output` references (both come from
 * `messageList.getPersisted.*.db()` computed once in `#runScorers` and
 * passed to every scorer by reference). So a WeakMap keyed on `run.output`
 * lets us run the expensive bits — text extraction and `isFinalReport` —
 * exactly once per workflow run and reuse across all five scorers.
 */
const preprocessCache = new WeakMap<object, ScorerPreprocessBase>();

export function preprocessRun(run: {
  input?: ScorerRunInputForAgent;
  output?: ScorerRunOutputForAgent;
}): ScorerPreprocessBase {
  const cacheKey = run.output ?? null;

  if (cacheKey) {
    const cached = preprocessCache.get(cacheKey);

    if (cached) return cached;
  }

  const text = extractReportText(run.output);
  // Concat all user-role messages across remembered + current turn so the
  // brief survives interrupt-and-resume runs (where `inputMessages` is just
  // the resumption text like "continue" and the real brief sits in memory).
  const briefMessages = [
    ...(run.input?.rememberedMessages ?? []),
    ...(run.input?.inputMessages ?? []),
  ].filter((m) => m.role === 'user');
  const brief = extractReportText(briefMessages);
  const isComplete = isFinalReport(text);
  const result: ScorerPreprocessBase = { text, brief, isComplete };

  if (cacheKey) preprocessCache.set(cacheKey, result);

  return result;
}

/**
 * Heuristic check: does this text look like a completed synthesizer report,
 * or like an interrupted/stuck/garbage agent run?
 *
 * Reports that pass the check are evaluated by all scorers. Reports that
 * fail short-circuit the scorer pipeline to keep dashboards clean and (for
 * LLM-judge scorers) cut judge cost by ~98% via a minimal skip prompt.
 */
export function isFinalReport(text: string): boolean {
  const matches = (p: RegExp) => p.test(text);

  return (
    text.length > MIN_REPORT_LENGTH &&
    !GARBAGE_PATTERNS.some(matches) &&
    EXPECTED_SECTION_PATTERNS.filter(matches).length >= MIN_SECTION_HITS
  );
}

// Strip code fences so a legit `<tool_call>` inside a code example doesn't
// trigger a false retry — only leaked tool-call markup in the model's own
// prose should count.
const stripFencedCode = (text: string) =>
  text.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');

export const hasLeakedToolCall = (text: string) =>
  !!text && TOOL_CALL_LEAK_PATTERNS.some((p) => p.test(stripFencedCode(text)));
