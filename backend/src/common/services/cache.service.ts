import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * 只读展示缓存（实训室热度等）。名额是否超发等强约束一律实时查库，绝不依赖缓存。
 * 配置 REDIS_URL 走 Redis，否则进程内 TTL Map 兜底。
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis: Redis | null = null;
  private redisReady = false;
  private readonly mem = new Map<string, { value: string; expireAt: number }>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) return;
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      retryStrategy: () => null,
    });
    this.redis = client;
    client
      .connect()
      .then(() => {
        this.redisReady = true;
      })
      .catch(() => undefined);
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redis && this.redisReady) {
      try {
        const raw = await this.redis.get(`cache:${key}`);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        this.redisReady = false;
      }
    }
    const hit = this.mem.get(key);
    if (!hit) return null;
    if (hit.expireAt <= Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return JSON.parse(hit.value) as T;
  }

  async set(key: string, value: unknown, ttlMs = 3000): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redis && this.redisReady) {
      try {
        await this.redis.set(`cache:${key}`, raw, 'PX', ttlMs);
        return;
      } catch {
        this.redisReady = false;
      }
    }
    this.mem.set(key, { value: raw, expireAt: Date.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    if (this.redis && this.redisReady) {
      try {
        await this.redis.del(`cache:${key}`);
      } catch {
        this.redisReady = false;
      }
    }
    this.mem.delete(key);
  }

  async onModuleDestroy() {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }
}
