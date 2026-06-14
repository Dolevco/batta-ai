import { FileSummarizer, SummaryItem } from './types';

/**
 * Summarizer for TypeScript and JavaScript files.
 *
 * Extracts: imports, classes, interfaces, type aliases, enums, functions,
 * methods (inside class context), and exported const variables / arrow functions.
 */
export class TypeScriptSummarizer implements FileSummarizer {
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
  readonly languageLabel = 'typescript';

  // Patterns applied per line (order matters — arrow fn before plain variable)
  private static readonly IMPORT_RE = /^import\s+.*\s+from\s+['"](.+)['"]/;
  private static readonly IMPORT_BARE_RE = /^import\s+['"](.+)['"]/;
  private static readonly CLASS_RE = /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/;
  private static readonly INTERFACE_RE = /(?:export\s+)?interface\s+(\w+)/;
  private static readonly TYPE_RE = /(?:export\s+)?type\s+(\w+)\s*[=<]/;
  private static readonly ENUM_RE = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/;
  private static readonly FUNCTION_RE = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/;
  private static readonly ARROW_FN_RE = /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/;
  private static readonly VARIABLE_RE = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/;
  private static readonly METHOD_RE = /^\s{2,}(?:(?:public|private|protected|async|static|override|readonly|abstract)\s+)*(\w+)\s*[(<]/;

  summarize(content: string): SummaryItem[] {
    const lines = content.split('\n');
    const items: SummaryItem[] = [];
    let inClass = false;
    let classIndentDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trimStart();
      const indent = line.length - trimmed.length;

      // Track brace depth for class-context detection
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
      }

      // Leave class context when we return to the brace depth before the class opened
      if (inClass && braceDepth <= classIndentDepth) {
        inClass = false;
      }

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      // import … from '…'
      let m = TypeScriptSummarizer.IMPORT_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'import', name: m[1] });
        continue;
      }
      m = TypeScriptSummarizer.IMPORT_BARE_RE.exec(line);
      if (m) {
        items.push({ line: lineNum, kind: 'import', name: m[1] });
        continue;
      }

      // class
      m = TypeScriptSummarizer.CLASS_RE.exec(line);
      if (m && indent === 0) {
        items.push({ line: lineNum, kind: 'class', name: m[1] });
        inClass = true;
        classIndentDepth = braceDepth - 1; // depth just before the opening brace
        continue;
      }

      // interface (top-level)
      if (indent === 0) {
        m = TypeScriptSummarizer.INTERFACE_RE.exec(line);
        if (m) {
          items.push({ line: lineNum, kind: 'interface', name: m[1] });
          continue;
        }

        // type alias
        m = TypeScriptSummarizer.TYPE_RE.exec(line);
        if (m) {
          items.push({ line: lineNum, kind: 'type', name: m[1] });
          continue;
        }

        // enum
        m = TypeScriptSummarizer.ENUM_RE.exec(line);
        if (m) {
          items.push({ line: lineNum, kind: 'enum', name: m[1] });
          continue;
        }

        // function declaration
        m = TypeScriptSummarizer.FUNCTION_RE.exec(line);
        if (m) {
          items.push({ line: lineNum, kind: 'function', name: m[1] });
          continue;
        }

        // arrow function (before plain variable check)
        m = TypeScriptSummarizer.ARROW_FN_RE.exec(line);
        if (m) {
          items.push({ line: lineNum, kind: 'function', name: m[1] });
          continue;
        }

        // exported const / let / var (excluding arrow fns already caught above)
        m = TypeScriptSummarizer.VARIABLE_RE.exec(line);
        if (m && /^(?:export\s+)?(?:const|let|var)/.test(line)) {
          items.push({ line: lineNum, kind: 'variable', name: m[1] });
          continue;
        }
      }

      // method inside a class
      if (inClass && indent >= 2) {
        m = TypeScriptSummarizer.METHOD_RE.exec(line);
        if (m && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while' && m[1] !== 'switch') {
          items.push({ line: lineNum, kind: 'method', name: m[1] });
        }
      }
    }

    return items;
  }
}
