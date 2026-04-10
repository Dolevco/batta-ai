import { GoSummarizer } from '../../../../tools/files/summarizers/goSummarizer';

const s = new GoSummarizer();

describe('GoSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .go extension', () => {
    expect(s.extensions).toContain('.go');
  });

  it('extracts package declaration', () => {
    const content = `package main\n`;
    expect(s.summarize(content)).toContainEqual({ line: 1, kind: 'package', name: 'main' });
  });

  it('extracts single-line import', () => {
    const content = `import "fmt"\n`;
    expect(s.summarize(content)).toContainEqual(expect.objectContaining({ kind: 'import', name: 'fmt' }));
  });

  it('extracts block imports', () => {
    const content = [
      'import (',
      '  "fmt"',
      '  "os"',
      ')',
    ].join('\n');
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'import', name: 'fmt' }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'import', name: 'os' }));
  });

  it('extracts struct', () => {
    const content = `type User struct {\n  Name string\n}`;
    expect(s.summarize(content)).toContainEqual(expect.objectContaining({ kind: 'struct', name: 'User' }));
  });

  it('extracts interface', () => {
    const content = `type Writer interface {\n  Write(b []byte) (int, error)\n}`;
    expect(s.summarize(content)).toContainEqual(expect.objectContaining({ kind: 'interface', name: 'Writer' }));
  });

  it('extracts top-level function', () => {
    const content = `func main() {\n}`;
    expect(s.summarize(content)).toContainEqual(expect.objectContaining({ kind: 'function', name: 'main' }));
  });

  it('extracts method (receiver syntax)', () => {
    const content = `func (u *User) GetName() string {\n  return u.Name\n}`;
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'method', name: 'GetName' }));
  });

  it('prefers method over function for receiver syntax', () => {
    const content = `func (r *Receiver) Handle(req Request) {}`;
    const items = s.summarize(content);
    expect(items.filter(i => i.kind === 'function')).toHaveLength(0);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'method', name: 'Handle' }));
  });

  it('reports correct line numbers', () => {
    const content = [
      'package main',   // 1
      '',
      'type Foo struct {}',  // 3
      'func Bar() {}',       // 4
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.kind === 'package')?.line).toBe(1);
    expect(items.find(i => i.kind === 'struct')?.line).toBe(3);
    expect(items.find(i => i.kind === 'function')?.line).toBe(4);
  });
});
