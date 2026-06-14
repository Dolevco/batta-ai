import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for Go files.
 *
 * Extracts: package declaration, imports (block and single-line),
 * structs, interfaces, top-level functions, and methods (receiver syntax).
 */
export class GoSummarizer implements FileSummarizer {
  readonly extensions = ['.go'];
  readonly languageLabel = 'go';

  private static readonly PACKAGE_RE = /^package\s+(\w+)/;
  private static readonly IMPORT_SINGLE_RE = /^import\s+"([^"]+)"/;
  private static readonly IMPORT_LINE_RE = /^\s+"([^"]+)"/;
  private static readonly STRUCT_RE = /^type\s+(\w+)\s+struct/;
  private static readonly INTERFACE_RE = /^type\s+(\w+)\s+interface/;
  private static readonly FUNCTION_RE = /^func\s+(\w+)\s*\(/;
  private static readonly METHOD_RE = /^func\s+\(\w+\s+\*?\w+\)\s+(\w+)\s*\(/;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];
    let inImportBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Enter/exit import block
      if (/^import\s+\(/.test(line)) {
        inImportBlock = true;
        continue;
      }
      if (inImportBlock) {
        if (line.trim() === ')') {
          inImportBlock = false;
          continue;
        }
        const m = GoSummarizer.IMPORT_LINE_RE.exec(line);
        if (m) {
          items.push({ line: lineNum, kind: 'import', name: m[1] });
        }
        continue;
      }

      // package
      let m = GoSummarizer.PACKAGE_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'package', name: m[1] });
        continue;
      }

      // single-line import
      m = GoSummarizer.IMPORT_SINGLE_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'import', name: m[1] });
        continue;
      }

      // struct
      m = GoSummarizer.STRUCT_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'struct', name: m[1] });
        continue;
      }

      // interface
      m = GoSummarizer.INTERFACE_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'interface', name: m[1] });
        continue;
      }

      // method (must come before function — more specific pattern)
      m = GoSummarizer.METHOD_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'method', name: m[1] });
        continue;
      }

      // top-level function
      m = GoSummarizer.FUNCTION_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'function', name: m[1] });
        continue;
      }
    }

    return items;
  }
}
