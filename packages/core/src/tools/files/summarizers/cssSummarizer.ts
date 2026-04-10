import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for CSS, SCSS, and Sass files.
 * Extracts: selectors, SCSS mixin names, and CSS custom property (variable) names.
 */
export class CssSummarizer implements FileSummarizer {
  readonly extensions = ['.css', '.scss', '.sass'];
  readonly languageLabel = 'css';

  private static readonly MIXIN_RE = /^@mixin\s+(\w[\w-]*)/;
  private static readonly CSS_VAR_RE = /^\s*(--[\w-]+)\s*:/;
  // A selector line ends with '{' and does not start with '@' (skip at-rules like @media)
  private static readonly SELECTOR_RE = /^([^@/\s{][^{]*)\s*\{/;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];
    let inRoot = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      // Track :root block for CSS variable extraction
      if (trimmed.startsWith(':root')) {
        inRoot = true;
      }
      if (inRoot && trimmed === '}') {
        inRoot = false;
      }

      // CSS variables inside :root
      if (inRoot) {
        const m = CssSummarizer.CSS_VAR_RE.exec(line);
        if (m) {
          items.push({ line: lineNum, kind: 'variable', name: m[1] });
          continue;
        }
      }

      // SCSS mixins
      let m = CssSummarizer.MIXIN_RE.exec(trimmed);
      if (m) {
        items.push({ line: lineNum, kind: 'mixin', name: m[1] });
        continue;
      }

      // Selectors: lines ending in '{' that are not @-rules
      m = CssSummarizer.SELECTOR_RE.exec(trimmed);
      if (m) {
        const selector = m[1].trim();
        items.push({ line: lineNum, kind: 'selector', name: selector });
      }
    }

    return items;
  }
}
