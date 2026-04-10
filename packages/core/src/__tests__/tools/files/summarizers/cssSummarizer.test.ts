import { CssSummarizer } from '../../../../tools/files/summarizers/cssSummarizer';

const s = new CssSummarizer();

describe('CssSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .css, .scss, .sass extensions', () => {
    expect(s.extensions).toContain('.css');
    expect(s.extensions).toContain('.scss');
    expect(s.extensions).toContain('.sass');
  });

  it('extracts a simple selector', () => {
    const items = s.summarize('.container {');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'selector', name: '.container' }));
  });

  it('extracts element selector', () => {
    const items = s.summarize('button {');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'selector', name: 'button' }));
  });

  it('extracts SCSS mixin', () => {
    const items = s.summarize('@mixin flex-center {');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'mixin', name: 'flex-center' }));
  });

  it('does not extract @media as a selector', () => {
    const items = s.summarize('@media (max-width: 768px) {');
    expect(items.filter(i => i.kind === 'selector')).toHaveLength(0);
  });

  it('extracts CSS variables inside :root', () => {
    const content = ':root {\n  --primary-color: #fff;\n  --spacing: 8px;\n}';
    const items = s.summarize(content);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'variable', name: '--primary-color' }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'variable', name: '--spacing' }));
  });

  it('skips comment lines', () => {
    const content = '// This is a comment\n.foo {';
    const items = s.summarize(content);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('selector');
  });

  it('reports correct line numbers', () => {
    const content = [
      '.foo {',      // 1
      '  color: red;',
      '}',
      '.bar {',      // 4
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.name === '.foo')?.line).toBe(1);
    expect(items.find(i => i.name === '.bar')?.line).toBe(4);
  });
});
