import { MarkdownSummarizer } from '../../../../tools/files/summarizers/markdownSummarizer';

const s = new MarkdownSummarizer();

describe('MarkdownSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .md extension', () => {
    expect(s.extensions).toContain('.md');
    expect(s.extensions).toContain('.mdx');
  });

  it('extracts h1 heading', () => {
    expect(s.summarize('# Hello World')).toContainEqual({ line: 1, kind: 'h1', name: 'Hello World' });
  });

  it('extracts h2 heading', () => {
    expect(s.summarize('## Section')).toContainEqual({ line: 1, kind: 'h2', name: 'Section' });
  });

  it('extracts h3 and h4 headings', () => {
    const content = '### Sub\n#### Sub-sub';
    const items = s.summarize(content);
    expect(items).toContainEqual({ line: 1, kind: 'h3', name: 'Sub' });
    expect(items).toContainEqual({ line: 2, kind: 'h4', name: 'Sub-sub' });
  });

  it('does not extract h5+ headings', () => {
    const content = '##### Too deep';
    expect(s.summarize(content)).toHaveLength(0);
  });

  it('does not mistake inline # as heading', () => {
    const content = 'This is a paragraph with # inside it';
    expect(s.summarize(content)).toHaveLength(0);
  });

  it('reports correct line numbers', () => {
    const content = [
      '# Title',     // 1
      '',
      'Some text.',  // 3 — not a heading
      '',
      '## Section',  // 5
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.kind === 'h1')?.line).toBe(1);
    expect(items.find(i => i.kind === 'h2')?.line).toBe(5);
  });

  it('trims trailing whitespace from heading text', () => {
    const items = s.summarize('## Hello   ');
    expect(items[0].name).toBe('Hello');
  });
});
