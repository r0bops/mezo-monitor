/**
 * Mezo Monitor — Fastify REST API + dashboard host.
 * Serves the React dashboard (packages/web/dist) at "/" and JSON at "/api/v1/*".
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { createDb, loadEnv } from "@mezo/core";
import { ChainHead } from "./chain-head.js";
import { getChain, registerRoutes, type Deps } from "./routes.js";
import type { ChainRow } from "./queries.js";

loadEnv();

const PORT = Number(process.env.API_PORT ?? 3000);
/**
 * Loopback by default so the API is never accidentally exposed to the public
 * internet on a host with a routable IP. Set API_HOST to the Tailscale address
 * (see .env.example) to serve the dashboard over the tailnet.
 */
const HOST = process.env.API_HOST ?? "127.0.0.1";
const CHAIN_REFRESH_MS = 30_000;

const { pool } = createDb();
const fastify = Fastify({ logger: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.join(here, "..", "..", "web", "dist");

/**
 * The chain row is cached rather than read per-request, but re-resolved on an
 * interval so the API recovers on its own once the indexer seeds it — starting
 * the API before the indexer is the normal first-run order.
 */
let chainRow: ChainRow | null = null;
let head: ChainHead | null = null;

async function refreshChain(): Promise<void> {
  try {
    const next = await getChain(pool, process.env.CHAIN_SLUG);
    if (!next) return;
    const changed = next.id !== chainRow?.id || next.rpc_url !== chainRow?.rpc_url;
    chainRow = next;
    if (changed) {
      head?.stop();
      head = new ChainHead(next.rpc_url);
      head.start();
      fastify.log.info({ chain: next.slug, chainId: next.chain_id }, "chain resolved");
    }
  } catch (e) {
    fastify.log.warn({ err: e }, "chain refresh failed (is postgres up?)");
  }
}

await refreshChain();
// Placeholder head until a chain resolves, so routes never dereference null.
head ??= new ChainHead("");

const deps: Deps = { pool, head: () => head!, chain: () => chainRow };

/**
 * Security headers and cache policy, applied before any route is registered
 * (Fastify hooks only cover routes that exist at registration time).
 *
 * - API/health responses are `no-store`: a proxy or browser must never serve
 *   stale monitor data — the dashboard's whole value is freshness.
 * - The SPA document gets the standard anti-embedding/sniffing set. CSP allows
 *   inline styles (the app is inline-styled by design) but no script sources
 *   beyond the same-origin bundle.
 */
fastify.addHook("onSend", async (req, reply, payload) => {
  if (req.url.startsWith("/api/") || req.url === "/health") {
    reply.header("cache-control", "no-store");
    return payload;
  }
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  reply.header(
    "content-security-policy",
    // connect-src https: lets the Direct RPC console query any CORS-enabled
    // https node straight from the visitor's browser (polkadot.js-style);
    // plain-http nodes stay blocked by mixed-content rules. img-src https:
    // allows the validator logos Keybase serves once identities sync.
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:",
  );
  return payload;
});

registerRoutes(fastify, deps);

/**
 * Which web bundle is deployed. A long-lived tab keeps running the JS it
 * loaded — no cache header fixes that — so the dashboard compares its own
 * script against this and offers a reload when they diverge.
 */
const deployedWeb = (() => {
  try {
    const html = readFileSync(path.join(webDist, "index.html"), "utf8");
    return html.match(/assets\/index-[^"]+\.js/)?.[0] ?? null;
  } catch {
    return null;
  }
})();
fastify.get("/api/v1/version", async () => ({ web: deployedWeb }));

const chainTimer = setInterval(() => void refreshChain(), CHAIN_REFRESH_MS);
chainTimer.unref();

// Dashboard (built SPA) + client-side routing fallback
if (existsSync(webDist)) {
  await fastify.register(fastifyStatic, { root: webDist, prefix: "/" });
  fastify.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/") && req.url !== "/health") {
      return reply.sendFile("index.html");
    }
    reply.code(404).send({ error: "not found" });
  });
} else {
  fastify.get("/", async () => ({
    status: "dashboard not built yet",
    hint: "run: pnpm --filter @mezo/web build",
  }));
}

const shutdown = async (sig: string) => {
  fastify.log.info({ sig }, "shutting down");
  clearInterval(chainTimer);

  head?.stop();
  try {
    await fastify.close();
  } finally {
    await pool.end();
    process.exit(0);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

fastify
  .listen({ port: PORT, host: HOST })
  .then(() => fastify.log.info(`mezo-monitor API + dashboard on http://${HOST}:${PORT}`))
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
