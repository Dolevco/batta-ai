import { YamlSummarizer } from '../../../../tools/files/summarizers/yamlSummarizer';

const s = new YamlSummarizer();

describe('YamlSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .yml and .yaml extensions', () => {
    expect(s.extensions).toContain('.yml');
    expect(s.extensions).toContain('.yaml');
  });

  it('extracts top-level key', () => {
    const items = s.summarize('name: Alice');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'name' }));
  });

  it('extracts second-level key', () => {
    const content = 'server:\n  port: 8080';
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'server' }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: '  port' }));
  });

  it('skips comment lines', () => {
    const content = '# This is a comment\nname: Bob';
    const items = s.summarize(content);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('name');
  });

  it('skips blank lines', () => {
    const content = '\n\nname: Bob\n\n';
    expect(s.summarize(content)).toHaveLength(1);
  });

  it('reports correct line numbers', () => {
    const content = [
      '# comment',   // 1 — skipped
      'foo: 1',      // 2
      '  bar: 2',    // 3
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.name === 'foo')?.line).toBe(2);
    expect(items.find(i => i.name === '  bar')?.line).toBe(3);
  });

  it('handles hyphenated keys', () => {
    const items = s.summarize('my-key: value');
    expect(items).toContainEqual(expect.objectContaining({ name: 'my-key' }));
  });
});
