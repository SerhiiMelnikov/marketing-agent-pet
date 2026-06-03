export interface ScorerPreprocessBase {
  /** The agent's final assistant text, extracted from the message-list payload. */
  text: string;
  /** The user brief that triggered the agent run. */
  brief: string;
  /** Whether `text` looks like a real synthesizer report (vs. interrupted/garbage). */
  isComplete: boolean;
}
