import { createClient, RedisClientType } from 'redis';

export interface TaskRunEvent {
  event: string;
  payload: unknown;
  timestamp: string;
}

export class RedisEventSubscriber {
  private subscriber: RedisClientType | null = null;
  private channelName: string;
  private isSubscribed = false;

  constructor(runId: string, private redisUrl?: string) {
    this.channelName = `task-run:${runId}`;
  }

  async subscribe(onEvent: (event: TaskRunEvent) => void, onError?: (err: Error) => void): Promise<void> {
    if (this.subscriber) return;

    const url = this.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.subscriber = createClient({ url });

    this.subscriber.on('error', (err: Error) => {
      console.error('Redis Subscriber Error:', err);
      if (onError) onError(err);
    });

    await this.subscriber.connect();

    await this.subscriber.subscribe(this.channelName, (message: string) => {
      try {
        const event = JSON.parse(message) as TaskRunEvent;
        onEvent(event);
      } catch (error) {
        console.error('Failed to parse Redis event:', error);
      }
    });

    this.isSubscribed = true;
  }

  async unsubscribe(): Promise<void> {
    if (!this.subscriber || !this.isSubscribed) return;

    try {
      await this.subscriber.unsubscribe(this.channelName);
      this.isSubscribed = false;
    } catch (error) {
      console.error('Failed to unsubscribe from Redis channel:', error);
    }
  }

  async close(): Promise<void> {
    await this.unsubscribe();
    
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }

  getChannelName(): string {
    return this.channelName;
  }
}
