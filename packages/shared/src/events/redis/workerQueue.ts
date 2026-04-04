import { createClient, RedisClientType } from 'redis';

export interface WorkerTask {
  taskId: string;
  runId: string;
  tenantId: string;
}

const WORKER_QUEUE_KEY = 'worker:tasks:queue';
const DEFAULT_TASK_TTL_SECONDS = process.env.WORKER_TASK_TTL_SECONDS ? parseInt(process.env.WORKER_TASK_TTL_SECONDS, 10) : undefined;

export class WorkerQueue {
  private client: RedisClientType | null = null;
  private redisUrl: string;
  private defaultTtlSeconds?: number;

  constructor(redisUrl?: string, defaultTtlSeconds?: number) {
    this.redisUrl = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.defaultTtlSeconds = defaultTtlSeconds ?? DEFAULT_TASK_TTL_SECONDS;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    this.client = createClient({ url: this.redisUrl });

    this.client.on('error', (err) => {
      console.error('Redis Worker Queue Error:', err);
    });

    await this.client.connect();
  }

  async enqueue(task: WorkerTask, ttlSeconds?: number): Promise<void> {
    if (!this.client) {
      await this.connect();
    }

    try {
      const ttl = ttlSeconds ?? this.defaultTtlSeconds;
      // Store the task under its own key. If ttl is provided, set an expiry; otherwise leave it persistent.
      const taskKey = `worker:task:${task.taskId}:${task.runId}`;
      const taskData = JSON.stringify(task);

      if (typeof ttl === 'number') {
        // Set the task data with EXPIRE so it will be removed within ttl seconds
        await this.client!.set(taskKey, taskData, { EX: ttl });
      } else {
        // No TTL requested — store without expiry
        await this.client!.set(taskKey, taskData);
      }

      // Push the task key onto the queue list
      await this.client!.rPush(WORKER_QUEUE_KEY, taskKey);
      if (typeof ttl === 'number') {
        console.log(`✅ Task enqueued to Redis: ${task.runId} (key=${taskKey}, ttl=${ttl}s)`);
      } else {
        console.log(`✅ Task enqueued to Redis: ${task.runId} (key=${taskKey}, no ttl)`);
      }
    } catch (error) {
      console.error('Failed to enqueue task to Redis:', error);
      throw error;
    }
  }

  async dequeue(): Promise<WorkerTask | null> {
    if (!this.client) {
      await this.connect();
    }

    try {
      // BLPOP with timeout for blocking pop (5 seconds)
      const result = await this.client!.blPop(WORKER_QUEUE_KEY, 5);

      if (!result) {
        return null;
      }

      const taskKey = result.element;
      // Retrieve the actual task payload stored under the taskKey
      const taskData = await this.client!.get(taskKey);

      if (!taskData) {
        // The task payload may have expired (TTL reached) before a worker processed it
        console.warn(`Task payload not found (may have expired): ${taskKey}`);
        return null;
      }

      // Remove the keyed task now that it's been claimed
      await this.client!.del(taskKey);

      const task = JSON.parse(taskData) as WorkerTask;
      console.log(`✅ Task dequeued from Redis: ${task.runId}`);
      return task;
    } catch (error) {
      console.error('Failed to dequeue task from Redis:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
