/**
 * Chain-head tracker. Indexer lag is (head - latest_indexed_height), and the
 * database alone cannot supply `head` — it only knows what was ingested. So we
 * poll the chain's CometBFT /status endpoint on an interval and cache it.
 *
 * The cache is deliberately fail-soft: an unreachable RPC yields a null head,
 * which the API reports as "lag unknown" rather than a fabricated zero.
 */

export type HeadState = {
  height: number | null;
  /** CometBFT node version from /status, surfaced in the dashboard header. */
  version: string | null;
  /** null until a poll succeeds; stale timestamps mark a degraded reading. */
  fetchedAt: Date | null;
  error: string | null;
};

const POLL_MS = 5_000;
const TIMEOUT_MS = 4_000;

export class ChainHead {
  private state: HeadState = { height: null, version: null, fetchedAt: null, error: null };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly rpcUrl: string) {}

  get current(): HeadState {
    return this.state;
  }

  /** Head is only trustworthy if a poll landed recently. */
  get isFresh(): boolean {
    if (!this.state.fetchedAt) return false;
    return Date.now() - this.state.fetchedAt.getTime() < POLL_MS * 4;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (!this.rpcUrl) {
      this.state = { height: null, version: null, fetchedAt: null, error: "no rpc_url configured" };
      return;
    }
    const url = this.rpcUrl.replace(/\/+$/, "") + "/status";
    const ctl = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctl });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      const h = json?.result?.sync_info?.latest_block_height;
      const height = Number(h);
      if (!Number.isFinite(height)) throw new Error("no sync_info.latest_block_height in /status");
      const version = json?.result?.node_info?.version ?? null;
      this.state = { height, version, fetchedAt: new Date(), error: null };
    } catch (e) {
      // Keep the last good height; only the error and staleness change.
      this.state = { ...this.state, error: (e as Error).message };
    }
  }
}
