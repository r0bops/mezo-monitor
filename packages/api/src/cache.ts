/**
 * Short-lived read-through cache for the expensive derived queries.
 *
 * `validatorMetrics` scans the whole signing window and costs ~0.5s; four routes
 * plus the alert evaluator all need it, and the dashboard asks for several of
 * them at once. Without coalescing, one refresh cycle runs the same scan five
 * times concurrently.
 *
 * The TTL is deliberately shorter than block cadence, so a cached read is never
 * more than one block stale.
 */

export class Cached<T> {
  private value: T | null = null;
  private loadedAt = 0;
  /** In-flight load, shared by every caller that misses at the same moment. */
  private inflight: Promise<T> | null = null;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
  ) {}

  async get(): Promise<T> {
    if (this.value !== null && Date.now() - this.loadedAt < this.ttlMs) {
      return this.value;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.load().then(
      (v) => {
        this.value = v;
        this.loadedAt = Date.now();
        this.inflight = null;
        return v;
      },
      (e) => {
        // Failures are not cached — the next caller retries rather than being
        // served a stale error for the rest of the TTL.
        this.inflight = null;
        throw e;
      },
    );
    return this.inflight;
  }

  invalidate(): void {
    this.value = null;
    this.loadedAt = 0;
  }
}

/**
 * Keyed cache factory. Chains are re-resolved at runtime, so caches are created
 * per chain id rather than assuming a single chain for the process lifetime.
 */
export class CacheMap<T> {
  private readonly entries = new Map<number, Cached<T>>();

  constructor(
    private readonly load: (key: number) => Promise<T>,
    private readonly ttlMs: number,
  ) {}

  get(key: number): Promise<T> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = new Cached(() => this.load(key), this.ttlMs);
      this.entries.set(key, entry);
    }
    return entry.get();
  }
}
