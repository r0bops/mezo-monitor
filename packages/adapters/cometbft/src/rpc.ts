import WebSocket from "ws";

/**
 * Minimal CometBFT RPC client: HTTP for /status /block /validators, plus a
 * self-healing WebSocket subscription for NewBlock events.
 * (Response typing is owned by parsers.ts; this returns raw JSON.)
 */

/**
 * When the node kept answering 429 even after backoff, stand down optional
 * traffic (status polls, gap repair) until this moment. Live block fetches
 * still try — they are the point of the indexer — but background loops
 * stopping means the rate budget goes to ingestion instead of to a /status
 * call every five seconds.
 */
let throttledUntil = 0;
export const isThrottled = (): boolean => Date.now() < throttledUntil;
const THROTTLE_COOLDOWN_MS = 30_000;

/**
 * Strip userinfo before a URL goes into an Error (and from there into logs):
 * node URLs may legitimately carry credentials, and every thrown message in
 * this client embeds the URL it failed on.
 */
function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    return u.toString();
  } catch {
    return url.replace(/\/\/[^/@:]+:[^/@]+@/, "//").replace(/\/\/[^/@]+@/, "//");
  }
}

export class CometbftRpc {
  /** Live subscription, retained so an endpoint switch can rebuild it. */
  private subscription: { close: () => void } | null = null;
  private onHeight: ((height: number) => void) | null = null;

  constructor(
    private rpcUrl: string,
    private wsUrl?: string,
  ) {}

  get endpoint(): string {
    return this.rpcUrl;
  }

  /**
   * Point the client at a different node. The WebSocket is torn down and
   * resubscribed; HTTP calls pick up the new URL immediately.
   *
   * Swapping in place rather than rebuilding the indexer keeps the ingest
   * cursor, gap scanner and backfill running across a failover — restarting
   * the cursor is precisely what used to lose blocks.
   */
  setEndpoint(rpcUrl: string, wsUrl?: string): void {
    if (rpcUrl === this.rpcUrl && wsUrl === this.wsUrl) return;
    this.rpcUrl = rpcUrl;
    this.wsUrl = wsUrl;
    if (this.onHeight) {
      this.subscription?.close();
      this.subscription = this.openSubscription(this.onHeight);
    }
  }

  async status(): Promise<any> {
    return this.http("/status");
  }

  async block(height?: number): Promise<any> {
    return this.http(height ? `/block?height=${height}` : "/block");
  }

  async validators(height: number | undefined, page: number, perPage: number): Promise<any> {
    const p = new URLSearchParams();
    if (height !== undefined) p.set("height", String(height));
    p.set("page", String(page));
    p.set("per_page", String(perPage));
    return this.http(`/validators?${p.toString()}`);
  }

  /** Page through every validator at (or near) `height`. */
  async allValidators(height?: number): Promise<any[]> {
    const out: any[] = [];
    let page = 1;
    for (;;) {
      const r: any = await this.validators(height, page, 100);
      const vals: any[] = r?.result?.validators ?? [];
      out.push(...vals);
      const total = Number(r?.result?.total ?? 0);
      if (vals.length === 0 || out.length >= total || page > 1000) break;
      page++;
    }
    return out;
  }

  private async http(p: string): Promise<any> {
    const url = this.rpcUrl.replace(/\/+$/, "") + p;
    // Rate-limited public nodes answer 429 long before they go down; retrying
    // with backoff keeps a shared endpoint usable instead of escalating every
    // throttled call into an ingest failure (and from there into a failover).
    let delayMs = 500;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) {
        const json: any = await res.json();
        if (json?.error) throw new Error(`RPC error ${redact(url)}: ${JSON.stringify(json.error)}`);
        return json;
      }
      if (res.status === 429 && attempt < 4) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15_000)
            : delayMs;
        delayMs = Math.min(delayMs * 2, 8_000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (res.status === 429) throttledUntil = Date.now() + THROTTLE_COOLDOWN_MS;
      throw new Error(`HTTP ${res.status} ${redact(url)}`);
    }
  }

  /**
   * Subscribe to NewBlock over WebSocket. `onHeight` fires for each new block.
   * Auto-reconnects with capped exponential backoff. Returns a stop handle.
   */
  subscribeNewBlock(onHeight: (height: number) => void): { close: () => void } {
    this.onHeight = onHeight;
    this.subscription = this.openSubscription(onHeight);
    return {
      close: () => {
        this.onHeight = null;
        this.subscription?.close();
        this.subscription = null;
      },
    };
  }

  private openSubscription(onHeight: (height: number) => void): { close: () => void } {
    let stopped = false;
    let ws: WebSocket | null = null;
    let attempt = 0;

    const connect = () => {
      if (stopped || !this.wsUrl) return;
      ws = new WebSocket(this.wsUrl);
      ws.on("open", () => {
        attempt = 0;
        ws!.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "subscribe",
            params: { query: "tm.event='NewBlock'" },
            id: 1,
          }),
        );
      });
      ws.on("message", (data) => {
        try {
          const m = JSON.parse(data.toString());
          const h = m?.result?.data?.value?.block?.header?.height;
          if (typeof h === "string" || typeof h === "number") onHeight(Number(h));
        } catch {
          /* ignore non-JSON / non-event frames */
        }
      });
      ws.on("error", () => {
        try {
          ws?.close();
        } catch {
          /* noop */
        }
      });
      ws.on("close", () => {
        if (stopped) return;
        attempt++;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        setTimeout(connect, delay);
      });
    };

    connect();
    return {
      close: () => {
        stopped = true;
        try {
          ws?.close();
        } catch {
          /* noop */
        }
      },
    };
  }
}
