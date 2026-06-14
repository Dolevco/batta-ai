import { MemoryEntry, MemoryMetadata, RetrievedMemory } from '../types';

/**
 * Storage backend for long-term memory.
 * Implement this interface to bring your own persistence layer (Postgres, SQLite, in-memory, etc.).
 */
export interface IMemoryStore {
  initialize(): Promise<void>;
  store(summary: string, tenantId: string, collectionName: string, embedding: number[], sessionId?: string, metadata?: MemoryMetadata): Promise<MemoryEntry>;
  search(queryEmbedding: number[], tenantId: string, collectionName: string, limit: number, minScore: number): Promise<RetrievedMemory[]>;
  delete(id: string, tenantId: string, collectionName: string): Promise<void>;
  listAll(tenantId: string, collectionName: string, limit: number): Promise<RetrievedMemory[]>;
  count(tenantId: string, collectionName: string): Promise<number>;
}
