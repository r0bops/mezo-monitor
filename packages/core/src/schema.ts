import {
  boolean,
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
