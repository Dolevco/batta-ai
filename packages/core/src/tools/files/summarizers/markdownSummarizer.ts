import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for Markdown / MDX files.
 * Extracts h1–h4 headings.
 */
export class MarkdownSummarizer implements FileSummarizer {
  readonly extensions = ['.md', '.mdx'];
  readonly languageLabel = 'markdown';

  private static readonly HEADING_RE = /^(#{1,4})\s+(.+)/;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const m = MarkdownSummarizer.HEADING_RE.exec(lines[i]);
      if (m) {
        const level = m[1].length; // 1–4
        items.push({ line: i + 1, kind: `h${level}`, name: m[2].trim() });
      }
    }

    return items;
  }
}
