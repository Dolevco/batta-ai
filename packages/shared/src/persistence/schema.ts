import { readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

const MIGRATION_FILES = [
  '001_initial.sql',
  '002_long_term_memory_session.sql',
  '003_drop_retired_tables.sql',
];

function loadMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
}

/**
 * Run all migrations in order. Each migration is idempotent (IF NOT EXISTS /
 * IF EXISTS guards), so re-running against an existing database is safe.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  for (const file of MIGRATION_FILES) {
    const sql = loadMigration(file);
    await pool.query(sql);
  }
}

// Legacy string exports — kept for any direct SQL consumers during transition.
export const SCHEMA_SQL: string = loadMigration('001_initial.sql');
export const MIGRATIONS_SQL: string = [
  loadMigration('002_long_term_memory_session.sql'),
  loadMigration('003_drop_retired_tables.sql'),
].join('\n');
