/**
 * Checkpoint Manager
 * 
 * Manages task checkpoints in Redis for resumability and fault tolerance
 */

import { Redis } from 'ioredis';
import { TaskCheckpoint, TaskStage } from '../types/queue.types';

export interface CheckpointManagerConfig {
  redisUrl?: string;
  ttlSeconds?: number; // Checkpoint TTL (default: 7 days)
}

export class CheckpointManager {
  private redis: Redis;
  private ttlSeconds: number;

  constructor(config: CheckpointManagerConfig = {}) {
    const url = config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new Redis(url);
    this.ttlSeconds = config.ttlSeconds || 7 * 24 * 60 * 60; // 7 days
  }

  /**
   * Save a checkpoint
   */
  async saveCheckpoint(checkpoint: TaskCheckpoint): Promise<void> {
    const key = this.getCheckpointKey(checkpoint.taskId);
    const value = JSON.stringify(checkpoint);
    await this.redis.setex(key, this.ttlSeconds, value);
  }

  /**
   * Get a checkpoint
   */
  async getCheckpoint(taskId: string): Promise<TaskCheckpoint | null> {
    const key = this.getCheckpointKey(taskId);
    const value = await this.redis.get(key);
    if (!value) return null;
    return JSON.parse(value);
  }

  /**
   * Delete a checkpoint (after successful completion)
   */
  async deleteCheckpoint(taskId: string): Promise<void> {
    const key = this.getCheckpointKey(taskId);
    await this.redis.del(key);
  }

  /**
   * Check if a checkpoint exists
   */
  async hasCheckpoint(taskId: string): Promise<boolean> {
    const key = this.getCheckpointKey(taskId);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Get the stage of a task
   */
  async getTaskStage(taskId: string): Promise<TaskStage | null> {
    const checkpoint = await this.getCheckpoint(taskId);
    return checkpoint?.stage || null;
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }

  private getCheckpointKey(taskId: string): string {
    return `checkpoint:${taskId}`;
  }
}
