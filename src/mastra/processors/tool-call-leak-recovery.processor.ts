import type {
  Processor,
  ProcessOutputStepArgs,
  ProcessorMessageResult,
} from '@mastra/core/processors';
import { hasLeakedToolCall } from '../scorers/extract-report-text';
import { logger } from '../../utils/logger';

const ID = 'tool-call-leak-recovery';
const log = logger.child({ module: ID });

/**
 * Detects when a model emits a tool call as text content (Gemma-style
 * `<|tool_call|>`, Llama-style `<tool_call>...</tool_call>`, `<function=...>`
 * tags) instead of using the function-calling protocol, and asks the model
 * to retry the step via `abort({ retry: true })`. Mastra feeds the abort
 * reason back to the model as corrective feedback.
 *
 * Capped at `maxRetries` per generation — after that, the leak is allowed
 * through so the scorer-level `isFinalReport` gate records it as a failure.
 */
export class ToolCallLeakRecoveryProcessor implements Processor<typeof ID> {
  readonly id = ID;
  readonly name = 'Tool Call Leak Recovery';

  constructor(private readonly maxRetries = 2) {}

  processOutputStep({
    text,
    abort,
    retryCount,
    messages,
  }: ProcessOutputStepArgs): ProcessorMessageResult {
    if (!text || !hasLeakedToolCall(text)) return messages;

    const headSample = text.slice(0, 160).replace(/\s+/g, ' ');

    if (retryCount >= this.maxRetries) {
      log.warn(
        `Leaked tool call detected; retry budget exhausted (${retryCount}/${this.maxRetries}) — letting output through. Head: ${headSample}`,
      );
      return messages;
    }

    log.warn(
      `Leaked tool call detected (retry ${retryCount + 1}/${this.maxRetries}); asking model to retry. Head: ${headSample}`,
    );

    return abort(
      'Your previous response contained text that looked like a function call ' +
        '(e.g. <tool_call>...</tool_call> or <function=...>) but was not an ' +
        'actual tool invocation — the runtime did not see a real function call. ' +
        'If you intended to call a tool, retry using the proper function-calling API. ' +
        'If not, answer in plain text without that markup.',
      { retry: true },
    );
  }
}
