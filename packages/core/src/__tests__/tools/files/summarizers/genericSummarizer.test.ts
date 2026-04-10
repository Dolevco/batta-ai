import { GenericSummarizer } from '../../../../tools/files/summarizers/genericSummarizer';

const s = new GenericSummarizer();

describe('GenericSummarizer', () => {
  it('always returns [] regardless of content', () => {
    expect(s.summarize('')).toEqual([]);
    expect(s.summarize('any content here\nwith multiple lines')).toEqual([]);
    expect(s.summarize('function foo() {}')).toEqual([]);
  });

  it('has empty extensions array (used as fallback)', () => {
    expect(s.extensions).toHaveLength(0);
  });

  it('has languageLabel "generic"', () => {
    expect(s.languageLabel).toBe('generic');
  });
});
