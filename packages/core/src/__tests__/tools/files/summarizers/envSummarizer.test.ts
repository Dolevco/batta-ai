import { EnvSummarizer } from '../../../../tools/files/summarizers/envSummarizer';

const s = new EnvSummarizer();

describe('EnvSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .env, .ini, .toml extensions', () => {
    expect(s.extensions).toContain('.env');
    expect(s.extensions).toContain('.ini');
    expect(s.extensions).toContain('.toml');
  });

  it('extracts key from KEY=value', () => {
    const items = s.summarize('API_KEY=super-secret');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'API_KEY' }));
  });

  it('does NOT include the value', () => {
    const items = s.summarize('SECRET=mysecretvalue');
    expect(JSON.stringify(items)).not.toContain('mysecretvalue');
  });

  it('extracts key from key: value (TOML-style)', () => {
    const items = s.summarize('database_url: postgres://localhost/db');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'key', name: 'database_url' }));
  });

  it('skips comment lines starting with #', () => {
    const content = '# This is a comment\nFOO=bar';
    expect(s.summarize(content)).toHaveLength(1);
    expect(s.summarize(content)[0].name).toBe('FOO');
  });

  it('skips comment lines starting with ;', () => {
    const content = '; ini comment\nFOO=bar';
    expect(s.summarize(content)).toHaveLength(1);
  });

  it('skips [section] headers', () => {
    const content = '[database]\nhost=localhost';
    const items = s.summarize(content);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('host');
  });

  it('skips blank lines', () => {
    const content = '\n\nFOO=1\n\nBAR=2\n';
    expect(s.summarize(content)).toHaveLength(2);
  });

  it('reports correct line numbers', () => {
    const content = [
      '# comment',   // 1 skipped
      'FOO=1',       // 2
      'BAR=2',       // 3
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.name === 'FOO')?.line).toBe(2);
    expect(items.find(i => i.name === 'BAR')?.line).toBe(3);
  });
});
