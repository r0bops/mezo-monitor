import WebSocket from "ws";

/**
 * Minimal CometBFT RPC client: HTTP for /status /block /validators, plus a
 * self-healing WebSocket subscription for NewBlock events.
 * (Response typing is owned by parsers.ts; this returns raw JSON.)
 */
export class CometbftRpc {
  constructor(
    private readonly rpcUrl: string,
    private readonly wsUrl?: string,
  ) {}

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
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const json: any = await res.json();
    if (json?.error) throw new Error(`RPC error ${url}: ${JSON.stringify(json.error)}`);
    return json;
  }

  /**
   * Subscribe to NewBlock over WebSocket. `onHeight` fires for each new block.
   * Auto-reconnects with capped exponential backoff. Returns a stop handle.
   */
  subscribeNewBlock(onHeight: (height: number) => void): { close: () => void } {
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
