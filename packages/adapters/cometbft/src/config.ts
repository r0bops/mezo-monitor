import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { z } from "zod";

const ChainConfigSchema = z.object({
  slug: z.string(),
  name: z.string(),
  chain_id: z.string(),
  family: z.literal("cometbft"),
  rpc_url: z.string(),
  ws_url: z.string().optional(),
  blockscout_url: z.string().optional(),
  capabilities: z.object({
    delegations: z.boolean(),
    governance: z.boolean(),
    slashing: z.boolean(),
    poa: z.boolean(),
  }),
});

export type ChainConfig = z.infer<typeof ChainConfigSchema>;

/** Replace ${VAR} tokens with process.env values. */
function interpolate(s: string): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => process.env[name] ?? "");
}

/** Walk up from this file to find the repo-root `chains/` directory. */
function findChainsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "chains");
    if (existsSync(candidate) && readdirSync(candidate).some((f) => f.endsWith(".yaml") || f.endsWith(".yml"))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error("chains/ directory not found (walked up from adapter src)");
}

/** Load + validate every chains/*.yaml (env-interpolated). */
export function loadChainConfigs(): ChainConfig[] {
  const chainsDir = findChainsDir();
  const files = readdirSync(chainsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (files.length === 0) throw new Error(`no *.yaml in ${chainsDir}`);
  return files.map((f) => {
    const raw = readFileSync(path.join(chainsDir, f), "utf8");
    const parsed = yaml.parse(interpolate(raw));
    return ChainConfigSchema.parse(parsed);
  });
}
