export type CacheProbe<T> = {
  value: T;
  hit: boolean;
};

export type CacheStats = {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
};

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
};

export class LruTtlCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly label: string;
  private readonly stats: CacheStats = { hits: 0, misses: 0, sets: 0, evictions: 0 };

  constructor(label: string, maxSize: number, ttlMs: number) {
    this.label = label;
    this.maxSize = Math.max(1, maxSize);
    this.ttlMs = Math.max(1000, ttlMs);
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.stats.misses += 1;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    this.stats.hits += 1;
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs && ttlMs > 0 ? ttlMs : this.ttlMs);
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, { value, expiresAt });
    this.stats.sets += 1;
    this.evictOldestIfNeeded();
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  getLabel(): string {
    return this.label;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  async getOrLoad(key: K, loader: () => Promise<V> | V, ttlMs?: number): Promise<CacheProbe<V>> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return { value: cached, hit: true };
    }
    const loaded = await loader();
    this.set(key, loaded, ttlMs);
    return { value: loaded, hit: false };
  }

  private evictOldestIfNeeded(): void {
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
      this.stats.evictions += 1;
    }
  }
}

