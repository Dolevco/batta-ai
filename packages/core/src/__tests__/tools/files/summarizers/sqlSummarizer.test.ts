import { SqlSummarizer } from '../../../../tools/files/summarizers/sqlSummarizer';

const s = new SqlSummarizer();

describe('SqlSummarizer', () => {
  it('returns [] for empty content', () => {
    expect(s.summarize('')).toEqual([]);
  });

  it('handles .sql extension', () => {
    expect(s.extensions).toContain('.sql');
  });

  it('extracts CREATE TABLE', () => {
    const items = s.summarize('CREATE TABLE users (id INT);');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'table', name: 'users' }));
  });

  it('extracts CREATE VIEW', () => {
    const items = s.summarize('CREATE VIEW active_users AS SELECT * FROM users;');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'view', name: 'active_users' }));
  });

  it('extracts CREATE FUNCTION', () => {
    const items = s.summarize('CREATE FUNCTION get_count() RETURNS INT;');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'function', name: 'get_count' }));
  });

  it('extracts CREATE PROCEDURE', () => {
    const items = s.summarize('CREATE PROCEDURE do_thing();');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'procedure', name: 'do_thing' }));
  });

  it('extracts CREATE OR REPLACE FUNCTION', () => {
    const items = s.summarize('CREATE OR REPLACE FUNCTION calc() RETURNS INT;');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'function', name: 'calc' }));
  });

  it('is case-insensitive', () => {
    const items = s.summarize('create table Orders (id int);');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'table', name: 'Orders' }));
  });

  it('handles schema-qualified names', () => {
    const items = s.summarize('CREATE TABLE public.accounts (id INT);');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'table', name: 'accounts' }));
  });

  it('reports correct line numbers', () => {
    const content = [
      '-- comment',
      'CREATE TABLE foo (id INT);',   // line 2
      'CREATE VIEW bar AS SELECT 1;', // line 3
    ].join('\n');
    const items = s.summarize(content);
    expect(items.find(i => i.name === 'foo')?.line).toBe(2);
    expect(items.find(i => i.name === 'bar')?.line).toBe(3);
  });
});
