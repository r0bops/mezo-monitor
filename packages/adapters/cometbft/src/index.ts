import { loadEnv } from "@mezo/core";
import { loadChainConfigs } from "./config";
import { runIndexer } from "./indexer";

loadEnv();
const configs = loadChainConfigs();
console.log(`mezo-monitor indexer: ${configs.length} chain(s) -> ${configs.map((c) => c.chain_id).join(", ")}`);

/** Seconds to wait before retrying a chain whose startup failed. */
const RETRY_MS = 15_000;

/**
 * Keep retrying a chain that fails to start. Startup touches the RPC (status,
 * validator set), so a node that is down at boot would otherwise leave that
 * chain permanently unindexed until someone restarted the service — precisely
 * the outage that failover exists to survive.
 */
function start(cfg: (typeof configs)[number]): void {
  runIndexer(cfg).catch((e) => {
    console.error(`indexer ${cfg.chain_id} failed, retrying in ${RETRY_MS / 1000}s:`, e);
    setTimeout(() => start(cfg), RETRY_MS);
  });
}

for (const cfg of configs) start(cfg);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
