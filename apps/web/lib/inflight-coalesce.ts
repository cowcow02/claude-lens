export class InflightCoalescer<K, V> {
  private readonly map = new Map<K, Promise<V>>();

  async run(key: K, worker: () => Promise<V>): Promise<V> {
    const existing = this.map.get(key);
    if (existing) return existing;
    const p = worker();
    this.map.set(key, p);
    try {
      return await p;
    } finally {
      this.map.delete(key);
    }
  }

  inflight(key: K): boolean {
    return this.map.has(key);
  }
}
