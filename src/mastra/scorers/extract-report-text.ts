/**
 * Mastra's agent-attached scorers receive `run.output` as the persisted
 * message-list payload — typically an array of structured message objects
 * with `content` parts, not a plain string. Coercing it directly into a
 * template literal yields "[object Object]" and breaks every regex-based
 * or LLM-prompt-based scorer.
 *
 * This helper walks the common shapes and returns the concatenated text.
 * Defensive: if the structure is something unexpected, falls back to JSON
 * serialization so at least the LLM judge gets something inspectable
 * rather than a literal "[object Object]" sentinel.
 */
export function extractReportText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;

  if (Array.isArray(output)) {
    return output.map(extractMessageText).filter(Boolean).join('\n\n');
  }

  if (typeof output === 'object') {
    // Mastra ScoringScorerInput shape:
    //   { inputMessages, rememberedMessages, systemMessages, taggedSystemMessages }
    // For scorer prompts the relevant part is `inputMessages` (the actual user
    // brief). systemMessages are agent instructions and would drown the prompt.
    const wrapper = output as { inputMessages?: unknown };
    if (Array.isArray(wrapper.inputMessages)) {
      const text = wrapper.inputMessages.map(extractMessageText).filter(Boolean).join('\n\n');
      if (text) return text;
    }

    // Single message object: { role, content, ... }
    const single = extractMessageText(output);
    if (single) return single;

    // Wrapped result: { text: '...' } or { output: '...' }
    const o = output as { text?: unknown; output?: unknown };
    if (typeof o.text === 'string') return o.text;
    if (typeof o.output === 'string') return o.output;
  }

  // Last-resort: serialize so the value is at least visible in prompts/logs.
  return JSON.stringify(output);
}

function extractMessageText(msg: unknown): string {
  if (msg == null) return '';
  if (typeof msg === 'string') return msg;
  if (typeof msg !== 'object') return '';

  const m = msg as { content?: unknown; text?: unknown };

  if (typeof m.text === 'string') return m.text;

  // Flat string content (older / simpler shape)
  if (typeof m.content === 'string') return m.content;

  // Structured content as a parts array (some Mastra paths put parts directly here)
  if (Array.isArray(m.content)) return joinTextParts(m.content);

  // Mastra UI message format v2: content is an object { format, parts: [...] }
  // — confirmed shape from Studio's persisted assistant messages. Each part has
  // a `type` discriminator; only `text` parts carry the user-visible response.
  // tool-invocation / step-start parts are skipped.
  if (m.content && typeof m.content === 'object') {
    const c = m.content as { parts?: unknown };
    if (Array.isArray(c.parts)) return joinTextParts(c.parts);
  }

  return '';
}

/**
 * Marker string for skipped scorer runs. Scorers prepend this to their
 * `generateReason` output so downstream dashboards can filter "didn't
 * evaluate" rows from "evaluated and scored low" rows.
 */
export const SKIPPED_REASON_PREFIX = 'SKIPPED:';

export const INCOMPLETE_MSG = `${SKIPPED_REASON_PREFIX} agent did not produce a final report.`;

export interface ScorerPreprocessBase {
  /** The agent's final assistant text, extracted from the message-list payload. */
  text: string;
  /** The user brief that triggered the agent run. */
  brief: string;
  /** Whether `text` looks like a real Phase-2 report (vs. interrupted/garbage). */
  isComplete: boolean;
}

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
 *
 * Memory: WeakMap entries are GC'd when the message-list object is dropped,
 * so no manual cleanup needed.
 */
const preprocessCache = new WeakMap<object, ScorerPreprocessBase>();

export function preprocessRun(run: { input?: unknown; output?: unknown }): ScorerPreprocessBase {
  // Only objects can key a WeakMap. If output is a string / null / undefined
  // (rare; tests or edge cases), fall back to recomputing without caching.
  const cacheKey = run.output && typeof run.output === 'object' ? run.output : null;
  if (cacheKey) {
    const cached = preprocessCache.get(cacheKey);
    if (cached) return cached;
  }

  const text = extractReportText(run.output);
  const brief = extractReportText(run.input);
  const isComplete = isFinalReport(text);
  const result: ScorerPreprocessBase = { text, brief, isComplete };

  if (cacheKey) preprocessCache.set(cacheKey, result);

  return result;
}

/**
 * Heuristic check: does this text look like a completed Phase-2 research
 * report, or like an interrupted/stuck/garbage agent run?
 *
 * Reports that pass the check are evaluated by all scorers. Reports that
 * fail short-circuit the scorer pipeline to keep dashboards clean and (for
 * LLM-judge scorers) cut judge cost by ~98% via a minimal skip prompt.
 *
 * Signals checked (any garbage match OR insufficient sections fails):
 *   1. Length — incomplete runs are usually short
 *   2. No template-token leakage (Gemma-style `<|tool_call|>`, etc.)
 *   3. No raw scorer-input dump (e.g. `"inputMessages":` in the text)
 *   4. Has at least 3 of the 8 expected Phase-2 section headers
 *
 * Calibrated for the researcher's Phase-2 section list: Executive Summary,
 * Market Trends, Competitor Landscape, Candidate ICPs, Fit Analysis,
 * Positioning Recommendation, Confidence & Gaps, Sources.
 */
export function isFinalReport(text: string): boolean {
  if (!text || text.length < MIN_REPORT_LENGTH) return false;
  if (GARBAGE_PATTERNS.some((p) => p.test(text))) return false;

  const sectionHits = EXPECTED_SECTION_PATTERNS.filter((p) => p.test(text)).length;
  return sectionHits >= MIN_SECTION_HITS;
}

const MIN_REPORT_LENGTH = 800;
const MIN_SECTION_HITS = 3;

const GARBAGE_PATTERNS = [
  /<\|tool_call/i,
  /<\|im_start\|>/i,
  /\[object Object\]/,
  /"inputMessages"\s*:/,
  /"systemMessages"\s*:/,
];

const EXPECTED_SECTION_PATTERNS = [
  /^#{1,6}\s*\d?[.)\s]*executive\s+summary/im,
  /^#{1,6}\s*\d?[.)\s]*market\s+trends/im,
  /^#{1,6}\s*\d?[.)\s]*competitor/im,
  /^#{1,6}\s*\d?[.)\s]*(candidate\s+)?icps?/im,
  /^#{1,6}\s*\d?[.)\s]*fit\s+analysis/im,
  /^#{1,6}\s*\d?[.)\s]*positioning/im,
  /^#{1,6}\s*\d?[.)\s]*confidence/im,
  /^#{1,6}\s*\d?[.)\s]*sources?\s*$/im,
];

function joinTextParts(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        const p = part as { type?: unknown; text?: unknown };
        // Treat both explicit `text` parts and parts with no type as text
        // (older Mastra versions omitted the discriminator for plain text).
        if ((p.type === 'text' || p.type === undefined) && typeof p.text === 'string') {
          return p.text;
        }
      }
      return '';
    })
    .filter(Boolean)
    .join('');
}
