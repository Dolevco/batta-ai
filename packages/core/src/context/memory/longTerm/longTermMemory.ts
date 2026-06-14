import { v4 as uuidv4 } from 'uuid';
import { IEmbeddingHandler } from '../../../llm';
import {
  LongTermMemoryConfig,
  MemoryEntry,
  MemoryMetadata,
  RetrievedMemory,
  MemoryInsight
} from '../types';
import { IMemoryStore } from './interfaces';
import { MemoryTask } from '../../../task/memoryTask';

type ResolvedLongTermMemoryConfig = Required<Omit<LongTermMemoryConfig, 'sessionId' | 'connectionString' | 'tenantId'>> & {
  sessionId?: string;
  tenantId: string;
};

const DEFAULT_CONFIG: Omit<ResolvedLongTermMemoryConfig, 'tenantId'> = {
  collectionName: 'agent_memories',
  vectorSize: 1536,
  maxRetrievedMemories: 5,
  minSimilarityScore: 0.7
};

export class LongTermMemory {
  private memoryStore: IMemoryStore;
  private config: ResolvedLongTermMemoryConfig;
  private memoryTaskCache: Map<string, any> = new Map();

  constructor(
    private embeddingHandler: IEmbeddingHandler,
    config: LongTermMemoryConfig & { store?: IMemoryStore },
    private llmApi?: any
  ) {
    if (!config.tenantId) {
      throw new Error('LongTermMemoryConfig.tenantId is required');
    }
    this.config = { ...DEFAULT_CONFIG, ...config, tenantId: config.tenantId };

    if (config.store) {
      this.memoryStore = config.store;
    } else {
      this.memoryStore = createPostgresMemoryStore(config.connectionString, this.config.vectorSize);
    }
  }

  async initialize(): Promise<void> {
    await this.memoryStore.initialize();
  }

  async store(summary: string, metadata?: MemoryMetadata): Promise<MemoryEntry> {
    await this.initialize();
    const embeddingResponse = await this.embeddingHandler.createEmbedding(summary);
    return this.memoryStore.store(
      summary,
      this.config.tenantId,
      this.config.collectionName,
      embeddingResponse.embedding,
      this.config.sessionId,
      metadata
    );
  }

  async search(query: string, limit?: number): Promise<RetrievedMemory[]> {
    await this.initialize();
    const embeddingResponse = await this.embeddingHandler.createEmbedding(query);
    return this.memoryStore.search(
      embeddingResponse.embedding,
      this.config.tenantId,
      this.config.collectionName,
      limit ?? this.config.maxRetrievedMemories,
      this.config.minSimilarityScore
    );
  }

  async delete(id: string): Promise<void> {
    await this.initialize();
    return this.memoryStore.delete(id, this.config.tenantId, this.config.collectionName);
  }

  async listAll(limit = 500): Promise<RetrievedMemory[]> {
    await this.initialize();
    return this.memoryStore.listAll(this.config.tenantId, this.config.collectionName, limit);
  }

  async count(): Promise<number> {
    await this.initialize();
    return this.memoryStore.count(this.config.tenantId, this.config.collectionName);
  }

  formatMemoriesAsContext(memories: RetrievedMemory[]): string {
    if (memories.length === 0) return '';
    return `Relevant past experiences:\n${memories.map((m, i) => `[Memory ${i + 1}] ${m.summary}`).join('\n')}`;
  }

  async storeMemoryInsight<T = Record<string, unknown>>(
    insight: MemoryInsight<T>,
    memoryType: string
  ): Promise<MemoryEntry> {
    await this.initialize();
    const embeddingResponse = await this.embeddingHandler.createEmbedding(insight.intent);
    const id = uuidv4();
    const timestamp = new Date();
    const payload = {
      intent: insight.intent,
      outcome: insight.outcome,
      executionPlan: insight.executionPlan,
      timestamp: timestamp.toISOString(),
      type: memoryType,
      data: insight.data,
      insights: insight.insights,
      tags: insight.tags || [],
      feedback: insight.feedback
    };
    await (this.store as any).storeRaw?.(
      id,
      this.config.tenantId,
      this.config.collectionName,
      embeddingResponse.embedding,
      this.config.sessionId ?? null,
      payload
    );
    console.log(`LongTermMemory: Stored ${memoryType} memory ${id}`);
    return {
      id,
      summary: insight.insights,
      timestamp,
      metadata: {
        issue: insight.intent,
        outcome: insight.outcome,
        solution: insight.executionPlan,
        tags: insight.tags
      }
    };
  }

  async searchMemoriesByType(
    query: string,
    memoryType: string,
    limit?: number
  ): Promise<MemoryInsight[]> {
    await this.initialize();
    const embeddingResponse = await this.embeddingHandler.createEmbedding(query);
    return (this.store as any).searchByType?.(
      embeddingResponse.embedding,
      this.config.tenantId,
      this.config.collectionName,
      memoryType,
      limit ?? this.config.maxRetrievedMemories,
      this.config.minSimilarityScore
    ) ?? [];
  }

  async storeWithInsightGeneration<TInput, TOutput>(
    data: TInput,
    memoryType: string,
    config: {
      processingInstructions: string;
      outputSchema?: string;
      exampleOutput?: TOutput;
    },
    intent?: string
  ): Promise<MemoryEntry> {
    if (!this.llmApi) {
      throw new Error('LLM API required for automatic insight generation. Provide it in constructor or use storeMemoryInsight directly.');
    }
    const memoryTask = this.getMemoryTask(memoryType, { memoryType, ...config });
    if (!memoryTask) {
      throw new Error('Failed to create MemoryTask for insight generation');
    }
    const insight = await memoryTask.generateInsight(data, intent);
    insight.intent = intent;
    return this.storeMemoryInsight(insight, memoryType);
  }

  private getMemoryTask(memoryType: string, config: any): any {
    if (!this.llmApi) return null;
    if (this.memoryTaskCache.has(memoryType)) return this.memoryTaskCache.get(memoryType);
    try {
      const task = new MemoryTask(this.llmApi, config);
      this.memoryTaskCache.set(memoryType, task);
      return task;
    } catch (error) {
      console.warn('Failed to create MemoryTask:', error);
      return null;
    }
  }
}

// ── Postgres memory store ─────────────────────────────────────────────────────
// Kept here for backward compatibility. Consumers can extract it to shared/ and
// inject it via config.store to avoid the pg optional dependency entirely.

import type { Pool as PgPool } from 'pg';

function createPostgresPool(connectionString: string): PgPool {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg');
    return new Pool({ connectionString });
  } catch {
    throw new Error(
      'pg is an optional dependency required for Postgres-backed long-term memory. Install it with: npm install pg'
    );
  }
}

export function createPostgresMemoryStore(connectionString?: string, vectorSize = 1536): PostgresMemoryStore {
  const cs = connectionString;
  if (!cs) {
    throw new Error(
      'LongTermMemoryConfig.connectionString is required when using the default Postgres store. ' +
      'Pass config.store to use a custom IMemoryStore instead.'
    );
  }
  return new PostgresMemoryStore(cs, vectorSize);
}

export class PostgresMemoryStore implements IMemoryStore {
  private pool: PgPool;
  private initialized = false;

  constructor(connectionString: string, private vectorSize: number) {
    this.pool = createPostgresPool(connectionString);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE EXTENSION IF NOT EXISTS "vector";

      CREATE TABLE IF NOT EXISTS long_term_memory (
        id          TEXT        NOT NULL,
        tenant_id   TEXT        NOT NULL,
        memory_type TEXT        NOT NULL DEFAULT 'general',
        session_id  TEXT,
        payload     JSONB       NOT NULL DEFAULT '{}',
        embedding   vector(${this.vectorSize}),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id)
      );

      ALTER TABLE long_term_memory
        ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default',
        ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'general',
        ADD COLUMN IF NOT EXISTS session_id TEXT;

      CREATE INDEX IF NOT EXISTS long_term_memory_tenant_type_idx
        ON long_term_memory (tenant_id, memory_type);
      CREATE INDEX IF NOT EXISTS long_term_memory_tenant_session_idx
        ON long_term_memory (tenant_id, session_id);

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'long_term_memory_tenant_id_id_key'
        ) THEN
          ALTER TABLE long_term_memory
            ADD CONSTRAINT long_term_memory_tenant_id_id_key UNIQUE (tenant_id, id);
        END IF;
      END $$;
    `);
    this.initialized = true;
  }

  async store(
    summary: string,
    tenantId: string,
    collectionName: string,
    embedding: number[],
    sessionId?: string,
    metadata?: MemoryMetadata
  ): Promise<MemoryEntry> {
    const id = uuidv4();
    const timestamp = new Date();
    const payload = { summary, timestamp: timestamp.toISOString(), ...metadata };
    await this.storeRaw(id, tenantId, collectionName, embedding, sessionId ?? null, payload);
    console.log(`PostgresMemoryStore: Stored memory ${id}`);
    return { id, summary, timestamp, metadata };
  }

  async storeRaw(
    id: string,
    tenantId: string,
    collectionName: string,
    embedding: number[],
    sessionId: string | null,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO long_term_memory (id, tenant_id, memory_type, session_id, embedding, payload)
       VALUES ($1, $2, $3, $4, $5::vector, $6)
       ON CONFLICT (tenant_id, id) DO UPDATE
       SET memory_type = EXCLUDED.memory_type,
           session_id = EXCLUDED.session_id,
           embedding = EXCLUDED.embedding,
           payload = EXCLUDED.payload`,
      [id, tenantId, collectionName, sessionId, `[${embedding.join(',')}]`, JSON.stringify(payload)]
    );
  }

  async search(
    queryEmbedding: number[],
    tenantId: string,
    collectionName: string,
    limit: number,
    minScore: number
  ): Promise<RetrievedMemory[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, payload, 1 - (embedding <=> $1::vector) AS score
         FROM long_term_memory
         WHERE tenant_id = $2
           AND memory_type = $3
           AND 1 - (embedding <=> $1::vector) >= $4
         ORDER BY embedding <=> $1::vector
         LIMIT $5`,
        [`[${queryEmbedding.join(',')}]`, tenantId, collectionName, minScore, limit]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        summary: (row.payload?.summary as string) || '',
        timestamp: new Date((row.payload?.timestamp as string) || Date.now()),
        score: parseFloat(row.score),
        metadata: {
          issue: row.payload?.issue as string | undefined,
          solution: row.payload?.solution as string | undefined,
          outcome: row.payload?.outcome as string | undefined,
          tags: row.payload?.tags as string[] | undefined
        }
      }));
    } catch (error) {
      console.error('PostgresMemoryStore: Failed to search memories', error);
      return [];
    }
  }

  async searchByType(
    queryEmbedding: number[],
    tenantId: string,
    collectionName: string,
    memoryType: string,
    limit: number,
    minScore: number
  ): Promise<MemoryInsight[]> {
    try {
      const result = await this.pool.query(
        `SELECT payload, 1 - (embedding <=> $1::vector) AS score
         FROM long_term_memory
         WHERE tenant_id = $2
           AND memory_type = $3
           AND payload->>'type' = $4
           AND 1 - (embedding <=> $1::vector) >= $5
         ORDER BY embedding <=> $1::vector
         LIMIT $6`,
        [`[${queryEmbedding.join(',')}]`, tenantId, collectionName, memoryType, minScore, limit]
      );
      return result.rows.map((row: any) => ({
        intent: (row.payload?.intent as string) || '',
        outcome: (row.payload?.outcome as string) || '',
        executionPlan: (row.payload?.executionPlan as string) || '',
        insights: (row.payload?.insights as string) || '',
        timestamp: new Date((row.payload?.timestamp as string) || Date.now()),
        score: parseFloat(row.score),
        data: row.payload?.data,
        tags: row.payload?.tags as string[] | undefined,
        feedback: row.payload?.feedback as string | undefined
      } as MemoryInsight));
    } catch (error) {
      console.error(`PostgresMemoryStore: Failed to search ${memoryType} memories`, error);
      return [];
    }
  }

  async delete(id: string, tenantId: string, collectionName: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM long_term_memory WHERE tenant_id = $1 AND id = $2 AND memory_type = $3',
      [tenantId, id, collectionName]
    );
    console.log(`PostgresMemoryStore: Deleted memory ${id}`);
  }

  async listAll(tenantId: string, collectionName: string, limit: number): Promise<RetrievedMemory[]> {
    try {
      const result = await this.pool.query(
        'SELECT id, payload FROM long_term_memory WHERE tenant_id = $1 AND memory_type = $2 ORDER BY created_at DESC LIMIT $3',
        [tenantId, collectionName, limit]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        summary: (row.payload?.summary as string) || (row.payload?.insights as string) || '',
        timestamp: new Date((row.payload?.timestamp as string) || Date.now()),
        score: 1.0,
        metadata: {
          issue: row.payload?.issue as string | undefined,
          solution: row.payload?.solution as string | undefined,
          outcome: row.payload?.outcome as string | undefined,
          tags: row.payload?.tags as string[] | undefined
        }
      }));
    } catch (error) {
      console.error('PostgresMemoryStore: Failed to list memories', error);
      return [];
    }
  }

  async count(tenantId: string, collectionName: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT COUNT(*)::int AS cnt FROM long_term_memory WHERE tenant_id = $1 AND memory_type = $2',
        [tenantId, collectionName]
      );
      return result.rows[0]?.cnt ?? 0;
    } catch (error) {
      console.error('PostgresMemoryStore: Failed to get count', error);
      return 0;
    }
  }
}
