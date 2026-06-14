import { JsonSummarizer } from '../../../../tools/files/summarizers/jsonSummarizer';

const s = new JsonSummarizer();

describe('JsonSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .json extension', () => {
    expect(s.extensions).toContain('.json');
  });

  it('returns [] for malformed JSON', () => {
    expect(s.summarize('{not valid json')).toEqual([]);
  });

  it('returns [] for JSON array at root', () => {
    expect(s.summarize('[1, 2, 3]')).toEqual([]);
  });

  it('extracts string key with hint', () => {
    const items = s.summarize(JSON.stringify({ name: 'Alice' }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'name: string' }));
  });

  it('extracts number key with hint', () => {
    const items = s.summarize(JSON.stringify({ count: 42 }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'count: number' }));
  });

  it('extracts boolean key with hint', () => {
    const items = s.summarize(JSON.stringify({ active: true }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'active: boolean' }));
  });

  it('extracts object key with hint', () => {
    const items = s.summarize(JSON.stringify({ config: { a: 1 } }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'config: object' }));
  });

  it('extracts array key with length hint', () => {
    const items = s.summarize(JSON.stringify({ items: [1, 2, 3] }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'items: array[3]' }));
  });

  it('extracts null key with hint', () => {
    const items = s.summarize(JSON.stringify({ empty: null }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'empty: null' }));
  });

  it('does not recurse below top level', () => {
    const items = s.summarize(JSON.stringify({ outer: { inner: 'value' } }));
    expect(items.map(i => i.name)).not.toContain(expect.stringContaining('inner'));
  });
});
