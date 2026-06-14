import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for SQL files.
 * Extracts CREATE TABLE, VIEW, FUNCTION, and PROCEDURE names.
 */
export class SqlSummarizer implements FileSummarizer {
  readonly extensions = ['.sql'];
  readonly languageLabel = 'sql';

  private static readonly CREATE_RE =
    /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(TABLE|VIEW|FUNCTION|PROCEDURE))\s+(?:\w+\.)?(\w+)/i;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const m = SqlSummarizer.CREATE_RE.exec(lines[i]);
      if (m) {
        const kind = m[1].toLowerCase(); // 'table' | 'view' | 'function' | 'procedure'
        items.push({ line: i + 1, kind, name: m[2] });
      }
    }

    return items;
  }
}
