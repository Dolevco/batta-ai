import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for Python files.
 *
 * Extracts: imports, classes, top-level functions, methods (indented defs),
 * and decorators (attached to the following def/class name).
 */
export class PythonSummarizer implements FileSummarizer {
  readonly extensions = ['.py', '.pyi'];
  readonly languageLabel = 'python';

  private static readonly IMPORT_RE = /^(?:import|from)\s+(\S+)/;
  private static readonly CLASS_RE = /^class\s+(\w+)/;
  private static readonly FUNCTION_RE = /^def\s+(\w+)/;
  private static readonly METHOD_RE = /^( {4,}|\t+)def\s+(\w+)/;
  private static readonly DECORATOR_RE = /^@(\w+)/;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];
    let pendingDecorator: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Decorator — capture for next def/class
      let m = PythonSummarizer.DECORATOR_RE.exec(line);
      if (m) {
        pendingDecorator = m[1];
        continue;
      }

      // import / from … import
      m = PythonSummarizer.IMPORT_RE.exec(line);
      if (m) {
        pendingDecorator = null;
        items.push({ line: lineNum, kind: 'import', name: m[1] });
        continue;
      }

      // top-level class
      m = PythonSummarizer.CLASS_RE.exec(line);
      if (m) {
        const name = pendingDecorator ? `@${pendingDecorator} ${m[1]}` : m[1];
        pendingDecorator = null;
        items.push({ line: lineNum, kind: 'class', name });
        continue;
      }

      // top-level function
      m = PythonSummarizer.FUNCTION_RE.exec(line);
      if (m) {
        const name = pendingDecorator ? `@${pendingDecorator} ${m[1]}` : m[1];
        pendingDecorator = null;
        items.push({ line: lineNum, kind: 'function', name });
        continue;
      }

      // method (indented def)
      m = PythonSummarizer.METHOD_RE.exec(line);
      if (m) {
        const name = pendingDecorator ? `@${pendingDecorator} ${m[2]}` : m[2];
        pendingDecorator = null;
        items.push({ line: lineNum, kind: 'method', name });
        continue;
      }

      pendingDecorator = null;
    }

    return items;
  }
}
