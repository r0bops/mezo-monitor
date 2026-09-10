/**
 * Test harness: a throwaway database, migrated from the real migration files so
 * the tests exercise the same schema production runs on.
 *
 * The dev database is never touched — everything happens in `mezo_monitor_test`,
 * which is dropped and recreated per run.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadEnv } from "@mezo/core";

loadEnv();

const TEST_DB = "mezo_monitor_test";

function adminUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set (check your .env)");
  // Connect to the default database to create/drop the test one.
  return base.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
}

export function testUrl(): string {
  const base = process.env.DATABASE_URL!;
  return base.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
}

/** Drop and recreate the test database, then apply all migrations. */
export async function createTestDb(): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: adminUrl() });
  try {
    // Terminate stragglers so DROP cannot block on a leaked connection.
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [TEST_DB],
    );
    await admin.query(`drop database if exists ${TEST_DB}`);
    await admin.query(`create database ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: testUrl() });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.join(here, "..", "..", "core", "migrations");
  await migrate(drizzle(pool), { migrationsFolder });
  return pool;
}

export async function dropTestDb(pool: pg.Pool): Promise<void> {
  await pool.end();
  const admin = new pg.Pool({ connectionString: adminUrl() });
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [TEST_DB],
    );
    await admin.query(`drop database if exists ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}

export type SeedSpec = {
  /** Highest block height to create. */
  head: number;
  /** How many blocks to create, counting down from head. */
  count: number;
  /** Validator addresses in the set. */
  validators: string[];
  /** Optional consensus address → moniker, as the LCD sync would store it. */
  monikers?: Record<string, string>;
  /**
   * Per-validator heights that were missed. Anything not listed is signed.
   */
  missed?: Record<string, number[]>;
  /** Per-validator heights where the validator was absent from the set. */
  absent?: Record<string, number[]>;
  /** Proposer per height; defaults to round-robin. */
  proposer?: (height: number, validators: string[]) => string;
  /** Heights to deliberately omit, simulating ingest gaps. */
  holes?: number[];
};

/** Chains are unique on slug, so each seeded chain needs its own. */
let seedCounter = 0;

/** Insert a deterministic chain, validator set, blocks and signatures. */
export async function seed(pool: pg.Pool, spec: SeedSpec): Promise<number> {
  const {
    head,
    count,
    validators,
    missed = {},
    absent = {},
    monikers = {},
    holes = [],
    proposer = (h, vs) => vs[h % vs.length],
  } = spec;

  const slug = `test-${++seedCounter}`;
  const chain = await pool.query<{ id: number }>(
    `insert into chains (slug, name, chain_id, family, rpc_url, capabilities)
     values ($1, 'Test', $2, 'cometbft', 'http://localhost:26657',
             '{"delegations":false,"governance":false,"slashing":false,"poa":true}'::jsonb)
     returning id`,
    [slug, `${slug}_1-1`],
  );
  const chainId = chain.rows[0].id;

  for (const [i, address] of validators.entries()) {
    await pool.query(
      `insert into validators (chain_id, address, moniker, voting_power, is_active, first_seen_height, last_seen_height)
       values ($1, $2, $3, 1, true, $4, $5)`,
      [chainId, address, monikers[address] ?? null, head - count + 1 + i, head],
    );
  }

  const holeSet = new Set(holes);
  // Fixed base time so block-time derivations are deterministic (3s spacing).
  const baseMs = Date.UTC(2026, 0, 1);

  for (let n = 0; n < count; n++) {
    const height = head - n;
    if (holeSet.has(height)) continue;
    const time = new Date(baseMs + height * 3_000);
    const present = validators.filter((v) => !(absent[v] ?? []).includes(height));
    const signers = present.filter((v) => !(missed[v] ?? []).includes(height));

    await pool.query(
      `insert into blocks (chain_id, height, hash, time, proposer_address, validator_count, signature_count, tx_count)
       values ($1, $2, $3, $4, $5, $6, $7, 0)`,
      [chainId, height, `hash-${height}`, time, proposer(height, validators), present.length, signers.length],
    );

    for (const v of present) {
      await pool.query(
        `insert into block_signatures (chain_id, height, validator_address, signed, time)
         values ($1, $2, $3, $4, $5)`,
        [chainId, height, v, signers.includes(v), time],
      );
    }
  }

  return chainId;
}
