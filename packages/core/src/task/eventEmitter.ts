import { EventEmitter } from 'events';
import { TaskEventMap } from '../task/types';

export class TypedEventEmitter<T extends Record<string | symbol, any> = TaskEventMap> extends EventEmitter {
  emit<K extends keyof T>(eventName: K, ...args: Parameters<T[K]>): boolean {
    return super.emit(eventName as string, ...args);
  }

  on<K extends keyof T>(eventName: K, listener: T[K]): this {
    return super.on(eventName as string, listener as (...args: any[]) => void);
  }

  once<K extends keyof T>(eventName: K, listener: T[K]): this {
    return super.once(eventName as string, listener as (...args: any[]) => void);
  }

  off<K extends keyof T>(eventName: K, listener: T[K]): this {
    return super.off(eventName as string, listener as (...args: any[]) => void);
  }

  addListener<K extends keyof T>(eventName: K, listener: T[K]): this {
    return super.addListener(eventName as string, listener as (...args: any[]) => void);
  }

  removeListener<K extends keyof T>(eventName: K, listener: T[K]): this {
    return super.removeListener(eventName as string, listener as (...args: any[]) => void);
  }

  removeAllListeners(event?: keyof T): this {
    return super.removeAllListeners(event as string | undefined);
  }

  listeners<K extends keyof T>(eventName: K): ((...args: unknown[]) => void)[] {
    return super.listeners(eventName as string) as ((...args: unknown[]) => void)[];
  }

  rawListeners<K extends keyof T>(eventName: K): ((...args: unknown[]) => void)[] {
    return super.rawListeners(eventName as string) as ((...args: unknown[]) => void)[];
  }

  listenerCount<K extends keyof T>(eventName: K): number {
    return super.listenerCount(eventName as string);
  }

  prependListener<K extends keyof T>(eventName: K, listener: T[K]): this {
    return super.prependListener(eventName as string, listener as (...args: any[]) => void);
  }

  prependOnceListener<K extends keyof T>(eventName: K, listener: T[K]): this {
    return super.prependOnceListener(eventName as string, listener as (...args: any[]) => void);
  }
}