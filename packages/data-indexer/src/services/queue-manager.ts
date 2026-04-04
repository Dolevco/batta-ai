/**
 * Queue Manager
 * 
 * Manages BullMQ queues for distributed task processing
 */

import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { IndexRepositoryTask, TaskType } from '../types/queue.types';

export interface QueueManagerConfig {
  redisUrl?: string;
  queueName?: string;
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: 'exponential';
      delay: number;
    };
    removeOnComplete?: boolean | number;
    removeOnFail?: boolean | number;
  };
}

export class QueueManager {
  private queue: Queue;
  private queueEvents: QueueEvents;
  private connection: Redis;

  constructor(config: QueueManagerConfig = {}) {
    const url = config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    
    // Create Redis connection
    this.connection = new Redis(url, {
      maxRetriesPerRequest: null,
    });

    const queueName = config.queueName || 'code-indexing';

    // Create queue
    this.queue = new Queue(queueName, {
      connection: this.connection,
      defaultJobOptions: config.defaultJobOptions || {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500, // Keep last 500 failed jobs
      },
    });

    // Create queue events for monitoring
    this.queueEvents = new QueueEvents(queueName, {
      connection: this.connection.duplicate(),
    });
  }

  /**
   * Add a repository indexing task to the queue
   */
  async enqueueIndexRepository(task: IndexRepositoryTask): Promise<string> {
    const job = await this.queue.add(
      TaskType.INDEX_REPOSITORY,
      task,
      {
        jobId: task.taskId,
        priority: 1, // Can be adjusted based on urgency
      }
    );
    return job.id!;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.queueEvents.close();
    await this.queue.close();
    await this.connection.quit();
  }

  /**
   * Drain the queue (remove all waiting and delayed jobs)
   */
  async drain(): Promise<void> {
    await this.queue.drain();
  }

  /**
   * Remove all jobs from the queue (completed, failed, waiting, etc.)
   */
  async obliterate(options?: { force?: boolean; count?: number }): Promise<void> {
    await this.queue.obliterate(options);
  }

  /**
   * Get the queue instance (for worker to consume)
   */
  getQueue(): Queue {
    return this.queue;
  }

  /**
   * Get the queue events instance
   */
  getQueueEvents(): QueueEvents {
    return this.queueEvents;
  }
}
