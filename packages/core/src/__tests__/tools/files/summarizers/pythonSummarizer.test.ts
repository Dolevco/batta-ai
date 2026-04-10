import { PythonSummarizer } from '../../../../tools/files/summarizers/pythonSummarizer';

const s = new PythonSummarizer();

describe('PythonSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .py extension', () => {
    expect(s.extensions).toContain('.py');
    expect(s.extensions).toContain('.pyi');
  });

  it('extracts import statement', () => {
    const content = `import os`;
    expect(s.summarize(content)).toContainEqual({ line: 1, kind: 'import', name: 'os' });
  });

  it('extracts from…import statement', () => {
    const content = `from pathlib import Path`;
    expect(s.summarize(content)).toContainEqual({ line: 1, kind: 'import', name: 'pathlib' });
  });

  it('extracts top-level class', () => {
    const content = `class Animal:\n    pass`;
    expect(s.summarize(content)).toContainEqual(expect.objectContaining({ kind: 'class', name: 'Animal' }));
  });

  it('extracts top-level function', () => {
    const content = `def greet(name):\n    return name`;
    expect(s.summarize(content)).toContainEqual(expect.objectContaining({ kind: 'function', name: 'greet' }));
  });

  it('extracts method (indented def)', () => {
    const content = [
      'class Dog:',
      '    def bark(self):',
      '        pass',
    ].join('\n');
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'method', name: 'bark' }));
  });

  it('attaches decorator to following def', () => {
    const content = [
      '@staticmethod',
      'def helper():',
      '    pass',
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.kind === 'function')?.name).toBe('@staticmethod helper');
  });

  it('attaches decorator to following class', () => {
    const content = [
      '@dataclass',
      'class Point:',
      '    x: int',
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.kind === 'class')?.name).toBe('@dataclass Point');
  });

  it('reports correct line numbers', () => {
    const content = [
      'import sys',   // 1
      '',
      'class Foo:',   // 3
      '    def bar(self):',  // 4
      '        pass',
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.kind === 'import')?.line).toBe(1);
    expect(items.find(i => i.kind === 'class')?.line).toBe(3);
    expect(items.find(i => i.kind === 'method')?.line).toBe(4);
  });
});
