import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Heading } from 'mdast';
import { MAX_SECTION_CHARS } from './constants';

export interface Section {
  /** Heading text without leading `#`s. `null` for content before the first heading. */
  heading: string | null;
  /** Heading depth 1-6, or 0 for preamble (content before first heading). */
  level: number;
  /** Body markdown for this section, excluding the heading line. */
  content: string;
  /** Character count of `content`. */
  contentChars: number;
  /** True when `content` was capped at MAX_SECTION_CHARS — full text is in the cache. */
  truncated: boolean;
}

export { MAX_SECTION_CHARS } from './constants';

/**
 * Split markdown into sections using a proper markdown AST (remark-parse)
 * rather than regex on heading lines. Two reasons to use the AST:
 *   1. Code blocks containing `#` characters (shell prompts, Python comments)
 *      are NOT mistakenly split as headings.
 *   2. Position info on every node lets us slice the original markdown
 *      losslessly, preserving whitespace, formatting, and inline markup.
 *
 * Sections are flat (no nesting). The `level` field tells the agent the
 * heading depth so it can reason about hierarchy. Content before the first
 * heading becomes a single preamble section with `heading: null, level: 0`.
 * Pages with no headings at all collapse to one preamble section containing
 * the entire markdown.
 */
export function extractSections(markdown: string): Section[] {
  if (!markdown.trim()) return [];

  const tree: Root = unified().use(remarkParse).parse(markdown);
  const headings: Array<{ node: Heading; startOffset: number; endOffset: number }> = [];

  for (const node of tree.children) {
    if (node.type === 'heading' && node.position) {
      const startOffset = node.position.start.offset;
      const endOffset = node.position.end.offset;
      if (startOffset === undefined || endOffset === undefined) {
        throw new Error('extract-sections: heading node missing position offsets');
      }
      headings.push({ node, startOffset, endOffset });
    }
  }

  const sections: Section[] = [];

  // Preamble: anything before the first heading (or the whole document if no headings)
  const firstHeadingStart = headings[0]?.startOffset ?? markdown.length;
  const preamble = markdown.slice(0, firstHeadingStart).trim();
  if (preamble) {
    sections.push(buildSection(null, 0, preamble));
  }

  // One section per heading: heading line + body until next heading
  for (let i = 0; i < headings.length; i++) {
    const { node, endOffset } = headings[i];
    const nextStart = headings[i + 1]?.startOffset ?? markdown.length;
    const bodyText = markdown.slice(endOffset, nextStart).trim();
    sections.push(buildSection(headingText(node), node.depth, bodyText));
  }

  return sections;
}

function buildSection(heading: string | null, level: number, content: string): Section {
  if (content.length > MAX_SECTION_CHARS) {
    return {
      heading,
      level,
      content: content.slice(0, MAX_SECTION_CHARS),
      contentChars: MAX_SECTION_CHARS,
      truncated: true,
    };
  }
  return {
    heading,
    level,
    content,
    contentChars: content.length,
    truncated: false,
  };
}

function headingText(node: Heading): string {
  return extractText(node).trim();
}

function extractText(node: { type: string; value?: string; children?: unknown[] }): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? '';
  }
  if (Array.isArray(node.children)) {
    return node.children
      .map((child) => extractText(child as { type: string; value?: string; children?: unknown[] }))
      .join('');
  }
  return '';
}
