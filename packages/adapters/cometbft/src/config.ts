import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { z } from "zod";

const EndpointSchema = z.object({
  label: z.string(),
  // Nullable because an unset ${VAR} interpolates to an empty value, which YAML
  // parses as null. Such endpoints are dropped in resolveEndpoints() rather
  // than failing the whole config — one missing backup should not stop the
  // indexer from starting on its primary.
  rpc_url: z.string().nullable().optional(),
  ws_url: z.string().nullable().optional(),
  /** Lower wins when several endpoints are healthy. */
  priority: z.number().int().optional(),
});

export type EndpointConfig = z.infer<typeof EndpointSchema>;

const ChainConfigSchema = z.object({
  slug: z.string(),
  name: z.string(),
  chain_id: z.string(),
  family: z.literal("cometbft"),
  rpc_url: z.string(),
  ws_url: z.string().optional(),
  /**
   * Cosmos LCD base URL (e.g. https://host/mezo) for modules the CometBFT RPC
   * cannot serve — Mezo's x/poa validator list carries the monikers. Nullable
   * for the same reason as endpoint URLs: an unset ${VAR} parses as null.
   */
  lcd_url: z.string().nullable().optional(),
  /**
   * Optional LCD failover list, tried in order until one answers. Mezo's REST
   * API (1317) is disabled by default on nodes, so public LCDs are rare — a
   * single dead provider would otherwise freeze monikers and logos forever.
   * Entries may be null (unset ${VAR}); see resolveLcdUrls.
   */
  lcd_urls: z.array(z.string().nullable().optional()).optional(),
  /**
   * Optional failover list. When absent, the top-level rpc_url/ws_url is used
   * as a single endpoint, so existing single-node configs keep working.
   */
  endpoints: z.array(EndpointSchema).optional(),
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

/**
 * The endpoint list for a chain, normalised.
 *
 * `interpolate()` resolves an unset `${VAR}` to an empty string, so an endpoint
 * whose environment variable is missing would otherwise be registered with a
 * blank URL and fail every probe. Those are dropped with a warning instead —
 * a misconfigured backup should be loud, not silently unhealthy forever.
 */
export function resolveEndpoints(
  cfg: ChainConfig,
): { label: string; rpc_url: string; ws_url: string; priority: number }[] {
  const declared: EndpointConfig[] = cfg.endpoints?.length
    ? cfg.endpoints
    : [{ label: "default", rpc_url: cfg.rpc_url, ws_url: cfg.ws_url }];

  const out: { label: string; rpc_url: string; ws_url: string; priority: number }[] = [];
  for (const [i, e] of declared.entries()) {
    if (!e.rpc_url || !/^https?:\/\//i.test(e.rpc_url)) {
      console.warn(
        `chain ${cfg.slug}: endpoint "${e.label}" has no usable rpc_url ` +
          `(unset \${VAR}?) — skipping`,
      );
      continue;
    }
    out.push({
      label: e.label,
      rpc_url: e.rpc_url,
      // An unresolved ws_url is merely absent; HTTP polling still works.
      ws_url: e.ws_url && /^wss?:\/\//i.test(e.ws_url) ? e.ws_url : "",
      priority: e.priority ?? (i + 1) * 10,
    });
  }
  if (out.length === 0) {
    throw new Error(`chain ${cfg.slug}: no usable RPC endpoints (check .env)`);
  }
  return out;
}

/**
 * The LCD base URLs for a chain, in failover order. `lcd_urls` wins when
 * present; otherwise the singular `lcd_url` is used alone. An unset ${VAR}
 * parses as null and is skipped with a warning, exactly like RPC endpoints —
 * a missing backup should be loud, not a failed boot.
 */
export function resolveLcdUrls(cfg: ChainConfig): string[] {
  const declared = cfg.lcd_urls ?? [cfg.lcd_url ?? null];
  const out = declared.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
  if (declared.length > out.length) {
    console.warn(
      `chain ${cfg.slug}: ${declared.length - out.length} LCD url(s) unusable (unset \${VAR}?) — skipped`,
    );
  }
  return out;
}
