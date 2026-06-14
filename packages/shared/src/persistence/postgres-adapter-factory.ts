import { PostgresDataAdapter } from '../persistence/data-adapter';
import { PostgresGraphAdapter } from '../persistence/graph-adapter';
import type { IEmbeddingHandler } from '@batta/core';
import { getPool } from '../persistence/client';

export function createPostgresDataAdapter(embeddingHandler: IEmbeddingHandler): PostgresDataAdapter {
  return new PostgresDataAdapter(getPool(), embeddingHandler);
}

export function createPostgresGraphAdapter(): PostgresGraphAdapter {
  return new PostgresGraphAdapter(getPool());
}
