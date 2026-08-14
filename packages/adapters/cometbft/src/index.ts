import { loadEnv } from "@mezo/core";
import { loadChainConfigs } from "./config";
import { runIndexer } from "./indexer";

loadEnv();
const configs = loadChainConfigs();
console.log(`mezo-monitor indexer: ${configs.length} chain(s) -> ${configs.map((c) => c.chain_id).join(", ")}`);

for (const cfg of configs) {
  runIndexer(cfg).catch((e) => console.error(`indexer ${cfg.chain_id} failed:`, e));
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
