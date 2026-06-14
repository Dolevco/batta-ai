/**
 * Checkpoint Manager
 *
 * Stores task checkpoints in-process for API-driven scans.
 * This keeps the task-processor resumability contract intact without requiring Redis.
 */

import { TaskCheckpoint, TaskStage } from './indexing-task.types';

export interface CheckpointManagerConfig {
  ttlSeconds?: number;
}

interface StoredCheckpoint {
  checkpoint: TaskCheckpoint;
  expiresAt?: number;
}

export class CheckpointManager {
  private readonly store = new Map<string, StoredCheckpoint>();
  private readonly ttlMs?: number;

  constructor(config: CheckpointManagerConfig = {}) {
    this.ttlMs = config.ttlSeconds ? config.ttlSeconds * 1000 : undefined;
  }

  async saveCheckpoint(checkpoint: TaskCheckpoint): Promise<void> {
    this.store.set(checkpoint.taskId, {
      checkpoint,
      expiresAt: this.ttlMs ? Date.now() + this.ttlMs : undefined,
    });
  }

  async getCheckpoint(taskId: string): Promise<TaskCheckpoint | null> {
    const stored = this.getStoredCheckpoint(taskId);
    return stored?.checkpoint ?? null;
  }

  async deleteCheckpoint(taskId: string): Promise<void> {
    this.store.delete(taskId);
  }

  async hasCheckpoint(taskId: string): Promise<boolean> {
    return this.getStoredCheckpoint(taskId) !== undefined;
  }

  async getTaskStage(taskId: string): Promise<TaskStage | null> {
    const checkpoint = await this.getCheckpoint(taskId);
    return checkpoint?.stage ?? null;
  }

  async close(): Promise<void> {
    this.store.clear();
  }

  private getStoredCheckpoint(taskId: string): StoredCheckpoint | undefined {
    const stored = this.store.get(taskId);
    if (!stored) return undefined;
    if (stored.expiresAt && stored.expiresAt <= Date.now()) {
      this.store.delete(taskId);
      return undefined;
    }
    return stored;
  }
}
