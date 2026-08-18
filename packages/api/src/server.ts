/**
 * Mezo Monitor — Fastify REST API + dashboard host.
 * Serves the React dashboard (packages/web/dist) at "/" and JSON at "/api/v1/*".
 */
import { existsSync } from "node:fs";
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
registerRoutes(fastify, deps);

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
