import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for JSON files.
 * Uses JSON.parse to extract top-level keys with a value-type hint.
 * Does not recurse below top level to keep output compact.
 */
export class JsonSummarizer implements FileSummarizer {
  readonly extensions = ['.json', '.jsonc'];
  readonly languageLabel = 'json';

  summarize(content: string): SummaryItem[] {
    const items: SummaryItem[] = [];
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      // Malformed JSON — return no items
      return items;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return items;
    }

    const obj = parsed as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      let hint: string;
      if (Array.isArray(value)) {
        hint = `array[${value.length}]`;
      } else if (value === null) {
        hint = 'null';
      } else {
        hint = typeof value; // 'string' | 'number' | 'boolean' | 'object'
      }
      // Line number is not meaningful for parsed JSON — use 1 as a convention
      items.push({ line: 1, kind: 'key', name: `${key}: ${hint}` });
    }

    return items;
  }
}
