// src/mastra/workflows/vertical-entry/normalize-citations.ts

/**
 * Some models emit native citation markers instead of the `[N]` format the
 * synthesizer is instructed to use:
 *   - `【1†Source title】` — OpenAI browsing-style daggered marker
 *   - `【1】`              — CJK fullwidth brackets
 * These are not produced by the current Claude synthesizer, but a future model
 * or prompt change could reintroduce them. This deterministic pass converts any
 * such marker back to `[N]` and strips stray fullwidth brackets, so the saved
 * report carries exactly one clean citation format. The `citation-format`
 * scorer still sees the raw model output and flags the misbehaviour.
 */
export function normalizeCitations(text: string): string {
  return text
    .replace(/【\s*(\d+)\s*[†‡][^】]*】/g, '[$1]') // 【1†Source…】 → [1]
    .replace(/【\s*(\d+)\s*】/g, '[$1]') // 【1】 → [1]
    .replace(/[【】]/g, ''); // strip any remaining stray fullwidth brackets
}
