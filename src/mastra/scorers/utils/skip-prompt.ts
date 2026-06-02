/**
 * Mastra always invokes `.analyze` when defined — we can't skip the judge
 * call on incomplete runs, but we can make it tiny. Returns a prompt that
 * asks the model to echo a fixed empty-shape JSON, costing ~30-50 tokens
 * instead of the full ~3000-token analysis prompt.
 */
export const buildSkipPrompt = (emptyShape: object) =>
  `Respond with exactly this JSON and nothing else:\n${JSON.stringify(emptyShape)}`;
