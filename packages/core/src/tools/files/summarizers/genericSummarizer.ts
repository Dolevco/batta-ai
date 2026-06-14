import { FileSummarizer, SummaryItem } from './types';

/**
 * Fallback summarizer for file types that have no dedicated summarizer.
 * Returns no items — only the metadata (file, type, total_lines, last_modified)
 * is meaningful for generic files.
 */
export class GenericSummarizer implements FileSummarizer {
  readonly extensions: string[] = [];
  readonly languageLabel = 'generic';

  summarize(_content: string): SummaryItem[] {
    return [];
  }
}
