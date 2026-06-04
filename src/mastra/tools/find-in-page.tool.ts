import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { getCache } from '../../modules/page-cache';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'find-in-page' });

const descriptions = {
  tool:
    'Search for a specific phrase or quote within a page you have already fetched in this research run. Use this instead of re-fetching the page or running a new web search when you remember that a fetched page contains a specific fact, quote, or number, and you need to locate it precisely or verify its surrounding context. You MUST have already fetched this URL in the current run. The tool will not fetch new pages. Typical use: after fetching a long page, use find-in-page with the specific phrase you need to extract for evidence. For finding multiple distinct phrases, call the tool once per phrase.',
  input: {
    url: 'The URL to search within. Must be a URL you have already fetched in this run.',
    query:
      'Plain-text phrase to search for. Case-insensitive substring match. For finding multiple distinct phrases, call the tool once per phrase.',
    contextChars:
      'Characters of surrounding context to return with each match (50-2000, default 300). Half before the match, half after.',
    maxMatches: 'Maximum number of matches to return (1-20, default 5).',
  },
  output: {
    found: 'True when at least one match was found in the cached page.',
    matches: 'Array of matches, each with the surrounding text snippet and the offset of the match in the cached markdown.',
    pageMetadata: 'Metadata about the cached page (title, finalUrl, fetchedAt, truncated). Present when the URL was found in the cache.',
    error:
      'Set when the URL was not previously fetched in this run (URL not in cache for this run). Returned as a structured response, not thrown.',
  },
} as const;

const matchSchema = z.object({
  snippet: z.string().describe('The matched phrase with surrounding context'),
  matchOffset: z.number().int().describe('Character offset of the match start in the cached markdown'),
});

const pageMetadataSchema = z.object({
  title: z.string().optional(),
  finalUrl: z.url(),
  fetchedAt: z.iso.datetime(),
  truncated: z.boolean(),
});

export const findInPageTool = createTool({
  id: 'find-in-page',
  description: descriptions.tool,
  inputSchema: z.object({
    url: z.url().describe(descriptions.input.url),
    query: z.string().min(1).describe(descriptions.input.query),
    contextChars: z.number().int().min(50).max(2000).default(300).describe(descriptions.input.contextChars),
    maxMatches: z.number().int().min(1).max(20).default(5).describe(descriptions.input.maxMatches),
  }),
  outputSchema: z.object({
    found: z.boolean().describe(descriptions.output.found),
    matches: z.array(matchSchema).describe(descriptions.output.matches),
    pageMetadata: pageMetadataSchema.optional().describe(descriptions.output.pageMetadata),
    error: z.string().optional().describe(descriptions.output.error),
  }),
  execute: async ({ url, query, contextChars, maxMatches }, { requestContext }) => {
    const runIdValue = requestContext?.get('runId');
    if (!runIdValue || typeof runIdValue !== 'string') {
      throw new Error('runId missing from requestContext — workflow misconfigured');
    }
    const cache = getCache();
    const entry = await cache.get(runIdValue, url);

    if (!entry) {
      log.info(`miss: ${url} (run ${runIdValue})`);
      return {
        found: false,
        matches: [],
        error: 'URL not previously fetched in this run. Use the fetch tool first.',
      };
    }

    const matches: { snippet: string; matchOffset: number }[] = [];
    const lowerMarkdown = entry.markdown.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const half = Math.floor((contextChars ?? 300) / 2);

    let cursor = 0;
    while (matches.length < (maxMatches ?? 5)) {
      const idx = lowerMarkdown.indexOf(lowerQuery, cursor);
      if (idx === -1) break;
      const from = Math.max(0, idx - half);
      const to = Math.min(entry.markdown.length, idx + lowerQuery.length + half);
      matches.push({ snippet: entry.markdown.slice(from, to), matchOffset: idx });
      cursor = idx + lowerQuery.length;
    }

    log.info(`${url} (run ${runIdValue}): "${query}" → ${matches.length} match(es)`);

    return {
      found: matches.length > 0,
      matches,
      pageMetadata: {
        title: entry.title,
        finalUrl: entry.finalUrl,
        fetchedAt: entry.fetchedAt,
        truncated: entry.truncated,
      },
    };
  },
});
