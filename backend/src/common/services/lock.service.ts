import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * 锁服务：配置 REDIS_URL 时使用 Redis SET NX PX 分布式锁；
 * 未配置或本地无 Redis 时降级为进程内串行锁（单实例足够，多实例请务必配置 Redis）。
 */
@Injectable()
export class LockService implements OnModuleDestroy {
  private readonly redis: Redis | null = null;
  private redisReady = false;
  private readonly queues = new Map<string, Promise<void>>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn('[lock] 未配置 REDIS_URL，使用进程内串行锁（本地兜底）');
      return;
    }
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
        // eslint-disable-next-line no-console
        console.log('[lock] Redis 已连接，启用分布式锁');
      })
      .catch((e: Error) => {
        // eslint-disable-next-line no-console
        console.warn(`[lock] Redis 不可用，降级为内存锁：${e.message}`);
      });
  }

  async withLock<T>(key: string, fn: () => Promise<T>, ttlMs = 10000): Promise<T> {
    if (this.redis && this.redisReady) {
      const redisKey = `lock:${key}`;
      const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      for (let i = 0; i < 40; i += 1) {
        try {
          const ok = await this.redis.set(redisKey, token, 'PX', ttlMs, 'NX');
          if (ok === 'OK') {
            try {
              return await fn();
            } finally {
              await this.redis
                .eval(
                  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
                  1,
                  redisKey,
                  token,
                )
                .catch(() => undefined);
            }
          }
        } catch (e) {
          // Redis 故障：降级内存锁，避免业务整体不可用
          this.redisReady = false;
          // eslint-disable-next-line no-console
          console.warn(`[lock] Redis 异常，降级为内存锁：${(e as Error).message}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.redisReady) throw new ServiceUnavailableException('系统繁忙，请稍后重试');
    }
    return this.memoryLock(key, fn);
  }

  private memoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) || Promise.resolve();
    const run = prev.then(fn, fn) as Promise<T>;
    const tail: Promise<void> = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  async onModuleDestroy() {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }
}
