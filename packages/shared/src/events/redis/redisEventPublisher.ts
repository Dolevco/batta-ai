import { createClient, RedisClientType } from 'redis';

export interface TaskEventPublisher {
  publish(event: string, payload: unknown): Promise<void>;
  close(): Promise<void>;
}

export class RedisEventPublisher implements TaskEventPublisher {
  private client: RedisClientType | null = null;
  private channelName: string;

  constructor(runId: string, private redisUrl?: string) {
    this.channelName = `task-run:${runId}`;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const url = this.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = createClient({ url });

    this.client.on('error', (err) => {
      console.error('Redis Publisher Error:', err);
    });

    await this.client.connect();
  }

  async publish(event: string, payload: unknown): Promise<void> {
    if (!this.client) {
      await this.connect();
    }

    try {
      const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
      await this.client!.publish(this.channelName, message);
    } catch (error) {
      console.error('Failed to publish event to Redis:', error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

export class NoOpEventPublisher implements TaskEventPublisher {
  async publish(_event: string, _payload: unknown): Promise<void> {
    // No-op implementation for when Redis is not configured
  }

  async close(): Promise<void> {
    // No-op
  }
}
