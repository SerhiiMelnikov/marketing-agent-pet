import { RequestContext } from '@mastra/core/request-context';
import { researcher } from '../../../agents/researcher';
import { logger } from '../../../../utils/logger';
import type { Mastra } from '@mastra/core/mastra';

export interface InvokeResearcherOptions {
  mastra: Mastra;
  threadId: string;
  resourceId: string;
  runId: string;
  prompt: string;
  maxSteps?: number;
}

export interface InvokeResearcherResult {
  completionSignal: string;
}

/**
 * Run the researcher agent on a given thread with the supplied prompt,
 * stream stdout in real time, and return the accumulated text. Used by
 * both the initial research step and the refine retry step — both pass
 * different prompts but share the streaming-consumption boilerplate.
 */
export async function invokeResearcher(
  opts: InvokeResearcherOptions,
): Promise<InvokeResearcherResult> {
  const agent = opts.mastra.getAgentById(researcher.id);
  const requestContext = new RequestContext<{ runId: string }>([['runId', opts.runId]]);

  const response = await agent.stream([{ role: 'user', content: opts.prompt }], {
    memory: { thread: opts.threadId, resource: opts.resourceId },
    requestContext,
    maxSteps: opts.maxSteps ?? 60,
  });

  let completionSignal = '';
  for await (const chunk of response.textStream) {
    process.stdout.write(chunk);
    completionSignal += chunk;
  }

  // Verify prompt caching is actually firing. `cachedInputTokens > 0` means the
  // provider served part of the prompt prefix from cache — for Gemini 2.5 this
  // is implicit caching (on by default). If it stays 0 across iterations, the
  // cached prefix is being invalidated every step (e.g. working-memory content
  // injected ahead of the volatile tail). Values are summed across all model
  // steps in this stream.
  const usage = await response.usage;
  logger.info('researcher model usage', {
    threadId: opts.threadId,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    outputTokens: usage.outputTokens,
  });

  return { completionSignal };
}
