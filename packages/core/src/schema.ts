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
 * Alert rule definitions. Thresholds are evaluated against the same derived
 * metrics the API serves (missed streak, uptime, indexer lag, block time), so
 * a rule never needs its own ingestion path. `metric` selects the evaluator;
 * `threshold` is compared with `comparator`.
 */
export const alertRules = pgTable(
  "alert_rules",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    metric: text("metric").notNull(), // "missed_streak" | "uptime_1000" | "indexer_lag" | "block_time"
    comparator: text("comparator").notNull(), // "gt" | "lt" | "gte" | "lte"
    threshold: doublePrecision("threshold").notNull(),
    severity: text("severity").notNull(), // "critical" | "warning" | "info"
    channel: text("channel"), // human label, e.g. "Webhook · PagerDuty"
    /**
     * Generic incoming-webhook URL. A plain JSON POST is accepted by Slack,
     * Discord and PagerDuty alike, so no provider-specific code is needed.
     * Null means the rule is dashboard-only.
     */
    webhookUrl: text("webhook_url"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byChain: index("alert_rules_chain_idx").on(t.chainId),
    chainNameUniq: uniqueIndex("alert_rules_chain_name_idx").on(t.chainId, t.name),
  }),
);

/**
 * Alert firings. `resolvedAt` set when the condition clears, which is what
 * renders a "Resolved" event. `subject` is the validator address when the rule
 * is per-validator, null for network-wide rules.
 */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    subject: text("subject"), // validator address, when applicable
    height: integer("height"),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /**
     * Delivery is tracked separately for the two transitions: an event notifies
     * once when it fires and again when it clears. Attempts and the last error
     * are kept so a silently failing webhook is visible rather than guessed at.
     */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    resolvedDeliveredAt: timestamp("resolved_delivered_at", { withTimezone: true }),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    deliveryAttemptAt: timestamp("delivery_attempt_at", { withTimezone: true }),
    deliveryError: text("delivery_error"),
  },
  (t) => ({
    byChainFired: index("alert_events_chain_fired_idx").on(t.chainId, t.firedAt),
    openByRule: index("alert_events_rule_open_idx").on(t.ruleId, t.subject, t.resolvedAt),
  }),
);

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
