import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Per-chain capability flags. Chain quirks live here (JSONB) instead of in
 * dedicated columns, so the schema stays chain-agnostic. Mezo (PoA) sets
 * delegations/governance/slashing = false, poa = true.
 */
export type ChainCapabilities = {
  delegations: boolean;
  governance: boolean;
  slashing: boolean;
  poa: boolean;
};

/** One row per configured chain. Seeded from chains/*.yaml on indexer start. */
export const chains = pgTable("chains", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  chainId: text("chain_id").notNull().unique(), // cosmos chain-id, e.g. "mezo_31612-1"
  family: text("family").notNull(), // "cometbft"
  rpcUrl: text("rpc_url").notNull(),
  wsUrl: text("ws_url"),
  blockscoutUrl: text("blockscout_url"), // outbound deep-links only
  capabilities: jsonb("capabilities").$type<ChainCapabilities>().notNull(),
  latestIndexedHeight: integer("latest_indexed_height"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * RPC endpoints available for a chain. Seeded from `chains/*.yaml` (the source
 * of truth for *which* endpoints exist) while selection and health live here,
 * so a node chosen in the UI survives a restart instead of being overwritten
 * by the config upsert.
 */
export const chainEndpoints = pgTable(
  "chain_endpoints",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // e.g. "primary", "backup"
    rpcUrl: text("rpc_url").notNull(),
    wsUrl: text("ws_url"),
    /** Lower wins when several endpoints are healthy. */
    priority: integer("priority").notNull().default(100),

    /** Exactly one active endpoint per chain (enforced by a partial index). */
    isActive: boolean("is_active").notNull().default(false),
    /** A manual choice: automatic failover must not override it. */
    pinned: boolean("pinned").notNull().default(false),

    healthy: boolean("healthy").notNull().default(false),
    lastHeight: integer("last_height"),
    latencyMs: integer("latency_ms"),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Idempotent YAML upserts key on the URL.
    chainUrlUniq: uniqueIndex("chain_endpoints_chain_url_idx").on(t.chainId, t.rpcUrl),
    oneActivePerChain: uniqueIndex("chain_endpoints_one_active_idx")
      .on(t.chainId)
      .where(sql`${t.isActive}`),
    byChain: index("chain_endpoints_chain_idx").on(t.chainId),
  }),
);

/** Known validators per chain (consensus address = signer/proposer identity). */
export const validators = pgTable(
  "validators",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    address: text("address").notNull(), // consensus address (hex)
    pubKey: text("pub_key"), // consensus public key
    moniker: text("moniker"), // best-effort, nullable (PoA may expose no moniker)
    /**
     * Keybase identity (64-hex) from the x/poa description, nullable. Resolved
     * to the operator's real logo by the API; a null here means the chain
     * exposed no identity, not that the validator has none.
     */
    identity: text("identity"),
    /**
     * Local, operator-assigned identity. Mezo is PoA with no staking module, so
     * the chain may never expose monikers; a human label ("Ours", "Broker X")
     * is the only way to answer "is mine healthy?".
     */
    label: text("label"),
    /** Marks validators this operator cares about; surfaced across the UI. */
    watched: boolean("watched").notNull().default(false),
    votingPower: integer("voting_power").default(0),
    isActive: boolean("is_active").notNull().default(true),
    firstSeenHeight: integer("first_seen_height"),
    lastSeenHeight: integer("last_seen_height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chainAddressUniq: uniqueIndex("validators_chain_address_idx").on(t.chainId, t.address),
    byChain: index("validators_chain_idx").on(t.chainId),
  }),
);

/**
 * Last-observed network location per validator.
 *
 * The chain carries no geography; this is derived from what the P2P network
 * itself discloses. CometBFT peers announce a moniker + IP in the handshake,
 * so a periodic /net_info sweep across the configured RPCs, matched by moniker
 * onto the known validator set, yields the node's observed IP — and geo-IP
 * yields where that node runs. Honest semantics: this is where a node with
 * the validator's moniker was last seen peering, not a registry entry; a
 * validator behind sentries shows its sentry. Missing rows mean "never
 * observed", never "unknown = 0".
 */
export const validatorLocations = pgTable(
  "validator_locations",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    validatorAddress: text("validator_address").notNull(),
    /** Moniker as announced in the P2P handshake (evidence for the match). */
    monikerSeen: text("moniker_seen").notNull(),
    ip: text("ip").notNull(),
    countryCode: text("country_code"),
    country: text("country"),
    city: text("city"),
    isp: text("isp"),
    /** Monotonically increasing observation counter across sweeps. */
    timesSeen: integer("times_seen").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chainAddressUniq: uniqueIndex("validator_locations_chain_address_idx").on(t.chainId, t.validatorAddress),
    byChain: index("validator_locations_chain_idx").on(t.chainId),
  }),
);

/** One row per indexed block. Composite PK (chain_id, height). */
export const blocks = pgTable(
  "blocks",
  {
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    height: integer("height").notNull(),
    hash: text("hash"),
    time: timestamp("time", { withTimezone: true }).notNull(),
    proposerAddress: text("proposer_address"),
    validatorCount: integer("validator_count"),
    signatureCount: integer("signature_count"),
    txCount: integer("tx_count"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.height] }),
    byChainHeight: index("blocks_chain_height_idx").on(t.chainId, t.height),
    byChainTime: index("blocks_chain_time_idx").on(t.chainId, t.time),
  }),
);

/**
 * One row per (validator, block): whether the validator signed that block's
 * commit. Drives uptime %, missed-streak, and the per-validator signing
 * heatmap. No FK on purpose (hot insert path); indexed for validator-centric
 * access patterns.
 */
export const blockSignatures = pgTable(
  "block_signatures",
  {
    chainId: integer("chain_id").notNull(),
    height: integer("height").notNull(),
    validatorAddress: text("validator_address").notNull(),
    signed: boolean("signed").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.height, t.validatorAddress] }),
    byValidatorHeight: index("block_sigs_validator_height_idx").on(
      t.validatorAddress,
      t.chainId,
      t.height,
    ),
    byChainHeight: index("block_sigs_chain_height_idx").on(t.chainId, t.height),
  }),
);

/**
 * Per-validator daily signing counts, rolled up from block_signatures by the
 * retention sweep. Raw per-block signatures are kept for the long uptime
 * window plus a margin; anything older is folded into this table and deleted,
 * so history is bounded in storage without being lost.
 */
export const validatorSigningDaily = pgTable(
  "validator_signing_daily",
  {
    chainId: integer("chain_id").notNull(),
    day: timestamp("day", { withTimezone: true }).notNull(), // UTC date_trunc('day', block time)
    validatorAddress: text("validator_address").notNull(),
    slots: integer("slots").notNull(),
    signed: integer("signed").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.day, t.validatorAddress] }),
  }),
);

/**
 * Retention bookkeeping: the newest height whose block_signatures have been
 * rolled into validator_signing_daily (and deleted). Ranges are aggregated at
 * most once, so a sweep that re-runs can never double-count.
 */
export const signatureRetention = pgTable("signature_retention", {
  chainId: integer("chain_id")
    .primaryKey()
    .references(() => chains.id, { onDelete: "cascade" }),
  lastHeight: integer("last_height").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Validator-set membership transitions (added/removed), polled periodically. */
export const validatorSetChanges = pgTable(
  "validator_set_changes",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    height: integer("height").notNull(),
    validatorAddress: text("validator_address").notNull(),
    changeType: text("change_type").notNull(), // "added" | "removed"
    votingPowerBefore: integer("voting_power_before"),
    votingPowerAfter: integer("voting_power_after"),
    time: timestamp("time", { withTimezone: true }).notNull(),
  },
  (t) => ({
    byChainHeight: index("vsc_chain_height_idx").on(t.chainId, t.height),
  }),
);
