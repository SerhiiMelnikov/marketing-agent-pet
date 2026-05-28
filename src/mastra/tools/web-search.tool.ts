import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { search } from '../../modules/search';

const descriptions = {
  tool: 'Search the web for up-to-date information on a topic. Returns a ranked list of results with title, URL, a short snippet, and (when available) extracted page content. Use this to gather evidence on market trends, competitors, regulations, or any claim that must be sourced rather than recalled from training data. Prefer narrow, specific queries; pass `includeDomains` to bias toward high-quality sources (e.g. analyst firms, trade press) when the domain matters.',

  input: {
    query:
      'The search query. Be specific and topical (e.g. "US healthcare IT outsourcing market size 2025") rather than broad ("healthcare").',
    includeDomains:
      'Restrict results to these domains (hostnames only, e.g. "gartner.com"). Use to bias toward authoritative sources for the vertical. Omit to search the open web.',
    maxResults:
      'Maximum number of results to return. Typical values: 5 for quick lookups, 10-20 for broader scans. Higher values cost more and add noise.',
  },

  output: {
    list: 'Ranked list of search results, most relevant first.',
    url: 'Canonical URL of the result page.',
    title: 'Page title as reported by the source.',
    snippet: 'Short summary of the page relevant to the query, suitable for quick scanning.',
    content:
      'Full extracted page content in plain text, when the provider was able to fetch it. Absent for results where only the snippet is available.',
  },
} as const;

export const webSearchTool = createTool({
  id: 'web-search',
  description: descriptions.tool,
  inputSchema: z.object({
    query: z.string().trim().nonempty().describe(descriptions.input.query),
    includeDomains: z.array(z.hostname()).optional().describe(descriptions.input.includeDomains),
    maxResults: z.int().optional().describe(descriptions.input.maxResults),
  }),
  outputSchema: z
    .array(
      z.object({
        url: z.url().describe(descriptions.output.url),
        title: z.string().describe(descriptions.output.title),
        snippet: z.string().describe(descriptions.output.snippet),
        content: z.string().optional().describe(descriptions.output.content),
      }),
    )
    .describe(descriptions.output.list),
  execute: (query) => search(query),
});
