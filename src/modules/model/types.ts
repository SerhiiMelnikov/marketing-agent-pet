/**
 * Any model id Mastra accepts. Two valid shapes:
 *   - Direct provider:  "google/gemini-2.5-flash", "anthropic/claude-opus-4.7"
 *   - Gateway-prefixed: "openrouter/google/gemini-2.5-flash"
 *
 * The template literal only enforces "has at least one slash" — runtime
 * validation by Mastra (and `mastraModelIdSchema` at env-parse time)
 * catches anything semantically wrong.
 *
 * `OpenRouterModel` is the strict openrouter-prefixed subtype defined in
 * `./openrouter-model`; it remains useful for the daily-rotation flow
 * which only deals with openrouter ids. For agents and env overrides
 * (which may name a direct provider) use `MastraModelId`.
 */
export type MastraModelId = `${string}/${string}`;
