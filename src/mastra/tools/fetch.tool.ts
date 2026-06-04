import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { fetchUrl } from '../../modules/fetch';
import { BlockReason } from '../../modules/fetch';
import { logger } from '../../utils/logger';
import { DEFAULT_BUDGET_CHARS, relevanceRank } from '../../modules/relevance-rank';

const log = logger.child({ module: 'fetch-tool' });

const descriptions = {
  tool: 'Fetch a single web page and return its main content as clean markdown. Use this after `web-search` when you need the full text of a result rather than just the snippet, or when an agent already has a known URL (e.g. a competitor homepage, a 10-K, an analyst report). Providers are tried in order — cheap HTTP+readability first, then Firecrawl for JS-heavy pages — so calls are best-effort and may return empty/short content for paywalls, bot walls, or dynamic apps. Long pages are truncated to a character budget; pass `extractHints` so the truncation keeps the sections most relevant to what you are looking for. After fetching a page, you can later search within it without re-fetching by calling `find-in-page` with the same URL.',

  input: {
    url: 'Absolute URL of the page to fetch. Must be a fully qualified http(s) URL.',
    requiresJs:
      'Hint that the page is JS-heavy (an SPA, dashboard, or paywalled article) and cheap providers will likely fail. Set true to skip straight to the JS-capable provider; leave omitted to let the chain decide.',
    extractHints:
      'Optional keywords or short phrases (2–5) for what you are hunting on this page — e.g. ["market size 2024", "CAGR", "Cognizant healthcare"]. Used to rank sections of long pages so the most relevant ones survive truncation. Without hints, long pages are trimmed by document order (lead sections kept) which may drop relevant later sections.',
  },

  output: {
    url: 'The URL that was requested.',
    finalUrl: 'The resolved URL after any redirects. May differ from `url`.',
    title: 'Page title, when the provider could extract one.',
    markdown:
      'Clean markdown extracted from the page, possibly truncated to a character budget when the page is long. May be empty or very short if the page was blocked, paywalled, or returned no meaningful content.',
    source: 'Name of the provider that produced this result (e.g. "firecrawl"). Useful for logs.',
    fetchedAt: 'ISO 8601 timestamp of when the fetch completed.',
    blocked:
      'Set when the page was reachable but its content was gated (login-wall, paywall, captcha, or cookie-wall). When this is present, the `markdown` field is unreliable — do NOT quote from it. Use the search snippet for this URL instead, or move on to another source.',
    blockedReason: 'Which gate was detected.',
    blockedSignal: 'What triggered detection (regex source or "title:..." marker), for debugging.',
  },
} as const;

export const fetchTool = createTool({
  id: 'fetch-url',
  description: descriptions.tool,
  inputSchema: z.object({
    url: z.url().describe(descriptions.input.url),
    requiresJs: z.boolean().optional().describe(descriptions.input.requiresJs),
    extractHints: z.array(z.string()).optional().describe(descriptions.input.extractHints),
  }),
  outputSchema: z.object({
    url: z.url().describe(descriptions.output.url),
    finalUrl: z.url().describe(descriptions.output.finalUrl),
    title: z.string().optional().describe(descriptions.output.title),
    markdown: z.string().describe(descriptions.output.markdown),
    source: z.string().describe(descriptions.output.source),
    fetchedAt: z.iso.datetime().describe(descriptions.output.fetchedAt),
    blocked: z
      .object({
        reason: z.enum(BlockReason).describe(descriptions.output.blockedReason),
        signal: z.string().describe(descriptions.output.blockedSignal),
      })
      .optional()
      .describe(descriptions.output.blocked),
  }),
  execute: async ({ url, requiresJs, extractHints }, { requestContext }) => {
    const runIdValue = requestContext?.get('runId');
    if (!runIdValue || typeof runIdValue !== 'string') {
      throw new Error('runId missing from requestContext — workflow misconfigured');
    }
    const result = await fetchUrl({ url, runId: runIdValue, requiresJs });
    if (!result.blocked && result.markdown.length > DEFAULT_BUDGET_CHARS) {
      const original = result.markdown.length;
      result.markdown = relevanceRank(result.markdown, extractHints);
      log.info(
        `Truncated ${url}: ${original} → ${result.markdown.length} chars` +
          (extractHints?.length ? ` (hints: ${extractHints.join(', ')})` : ' (no hints, head cap)'),
      );
    }
    return result;
  },
});
