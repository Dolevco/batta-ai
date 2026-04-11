import { TypeScriptSummarizer } from '../../../../tools/files/summarizers/typescriptSummarizer';

const s = new TypeScriptSummarizer();

describe('TypeScriptSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles extensions', () => {
    expect(s.extensions).toContain('.ts');
    expect(s.extensions).toContain('.tsx');
    expect(s.extensions).toContain('.js');
    expect(s.extensions).toContain('.jsx');
  });

  it('extracts named imports', () => {
    const content = `import { foo, bar } from 'some-module';`;
    const items = s.summarize(content);
    expect(items).toContainEqual({ line: 1, kind: 'import', name: 'some-module' });
  });

  it('extracts default import', () => {
    const content = `import defaultExport from './utils';`;
    const items = s.summarize(content);
    expect(items).toContainEqual({ line: 1, kind: 'import', name: './utils' });
  });

  it('extracts class', () => {
    const content = `export class MyService {\n  constructor() {}\n}`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'class', name: 'MyService' }));
  });

  it('extracts abstract class', () => {
    const content = `export abstract class Base {\n}`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'class', name: 'Base' }));
  });

  it('extracts interface', () => {
    const content = `export interface UserConfig {\n  name: string;\n}`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'interface', name: 'UserConfig' }));
  });

  it('extracts type alias', () => {
    const content = `export type UserId = string;`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'type', name: 'UserId' }));
  });

  it('extracts enum', () => {
    const content = `export enum Direction {\n  Up,\n  Down,\n}`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'enum', name: 'Direction' }));
  });

  it('extracts function declaration', () => {
    const content = `export async function fetchUser(id: string) {\n  return {};\n}`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'function', name: 'fetchUser' }));
  });

  it('extracts arrow function', () => {
    const content = `export const handleRequest = async (req: any) => {\n  return;\n};`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'function', name: 'handleRequest' }));
  });

  it('extracts exported const variable', () => {
    const content = `export const MAX_RETRIES = 3;`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'variable', name: 'MAX_RETRIES' }));
  });

  it('extracts methods inside a class', () => {
    const content = [
      'export class Foo {',
      '  public doWork() {',
      '    return 42;',
      '  }',
      '  private helper() {}',
      '}',
    ].join('\n');
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'method', name: 'doWork' }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'method', name: 'helper' }));
  });

  it('reports correct line numbers', () => {
    const content = [
      'import { A } from "a";',    // line 1
      '',
      'export class Foo {',         // line 3
      '  bar() {}',                 // line 4
      '}',
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.kind === 'import')?.line).toBe(1);
    expect(items.find(i => i.kind === 'class')?.line).toBe(3);
    expect(items.find(i => i.kind === 'method')?.line).toBe(4);
  });

  it('does not extract methods outside class context', () => {
    // A function that looks indented but is not in a class
    const content = `function outer() {\n  function inner() {}\n}`;
    const items = s.summarize(content);
    // 'outer' is a function; 'inner' should not appear as a method since we're not in a class
    expect(items.filter(i => i.kind === 'method')).toHaveLength(0);
  });
});
