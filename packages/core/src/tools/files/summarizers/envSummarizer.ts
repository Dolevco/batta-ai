import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for .env, .ini, and .toml files.
 *
 * SECURITY: Only key names are extracted — values are deliberately ignored
 * because they frequently contain secrets, API keys, or passwords.
 */
export class EnvSummarizer implements FileSummarizer {
  readonly extensions = ['.env', '.ini', '.toml'];
  readonly languageLabel = 'env';

  // Match lines like:  KEY=value  /  KEY = value  /  key: value  /  key=value
  // Captures only the key portion; the value is intentionally discarded.
  private static readonly KEY_RE = /^([A-Za-z_][A-Za-z0-9_.]*)\s*[=:]/;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip blank lines and comments (# and ;)
      if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }

      // Skip [section] headers in .ini / .toml — not a key
      if (trimmed.startsWith('[')) {
        continue;
      }

      const m = EnvSummarizer.KEY_RE.exec(trimmed);
      if (m) {
        // Emit key name only — never the value
        items.push({ line: i + 1, kind: 'key', name: m[1] });
      }
    }

    return items;
  }
}
