import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for YAML files.
 * No external YAML parser — detects top-level and second-level keys by indentation.
 */
export class YamlSummarizer implements FileSummarizer {
  readonly extensions = ['.yml', '.yaml'];
  readonly languageLabel = 'yaml';

  // Top-level key: no leading whitespace, word chars, colon
  private static readonly TOP_KEY_RE = /^([\w][\w-]*)\s*:/;
  // Second-level key: exactly 2 spaces of indentation
  private static readonly SECOND_KEY_RE = /^ {2}([\w][\w-]*)\s*:/;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip comments and blank lines
      if (line.trimStart().startsWith('#') || line.trim() === '') {
        continue;
      }

      // Second-level keys (checked before top-level to avoid misclassification)
      let m = YamlSummarizer.SECOND_KEY_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'key', name: `  ${m[1]}` });
        continue;
      }

      // Top-level keys
      m = YamlSummarizer.TOP_KEY_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'key', name: m[1] });
        continue;
      }
    }

    return items;
  }
}
