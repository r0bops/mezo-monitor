/**
 * Tests for the LCD moniker path: bech32 decoding, the CometBFT consensus
 * address derivation, and the database sync.
 *
 * The vectors are real mainnet values (x/poa LCD, mezo_31612-1) so the
 * derivation is tested against the chain's own addresses, not a self-consistent
 * fixture that would pass even if wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@mezo/core";
import { createTestDb, dropTestDb, seed } from "../../../api/test/setup.js";
import { consensusAddress, monikersFromLcd, syncMonikers } from "../src/monikers.js";

// Real mainnet pubkeys → monikers, from https://mezo.api.nodeshub.online/mezo/poa/v1/validators
const VECTORS: [string, string, string][] = [
  // [bech32 pubkey, consensus address (verified against the chain), moniker]
  [
    "mezovalconspub1zcjduepqcfaf4qf4m8spt2s5ksrdkcm79kflewggy0f62yzcm9upnp0n68ps9kqqh2",
    "5ADDD2EAAC2CD5FA43BA5C62433912807215474A",
    "voyage-through-time",
  ],
  [
    "mezovalconspub1zcjduepq5jqypnmxsxpjhq4uh2f9yl6ntrm33vr5y8ce9c9gu49zr7t26jwq4ef0j9",
    "919F0AC3136CE30A326BF5F549D10EA6CFE98159",
    "StakingCabin",
  ],
  [
    "mezovalconspub1zcjduepq0cl8arzytx2c4ekl7ff4h4r54qe6x2etef4v90t8hlz79crgwy7sf4nhpq",
    "143E66AFE2A69BC2A4A2B3A088E82ED007E06F1B",
    "Node.Monster",
  ],
];

// Fixture consensus addresses use the same shape as the chain (lowercase hex).
const A = VECTORS[0][1].toLowerCase();
const B = VECTORS[1][1].toLowerCase();
const C = VECTORS[2][1].toLowerCase();

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let chainId: number;

beforeAll(async () => {
  pool = await createTestDb();
  db = drizzle(pool, { schema });
  chainId = await seed(pool, { head: 100, count: 10, validators: [A, B, C] });
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

describe("consensusAddress", () => {
  it("derives the chain's own addresses from the LCD pubkeys", () => {
    for (const [pub, addr] of VECTORS) {
      expect(consensusAddress(pub)).toBe(addr);
    }
  });

  it("rejects malformed bech32 rather than guessing", () => {
    expect(() => consensusAddress("notbech32")).toThrow();
    expect(() => consensusAddress("mezovalconspub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")).toThrow();
  });
});

describe("monikersFromLcd", () => {
  it("maps every well-formed entry and skips broken ones", () => {
    const json = {
      validators: [
        // A carries a Keybase identity alongside its moniker
        {
          cons_pub_key_bech32: VECTORS[0][0],
          description: { moniker: "voyage-through-time", identity: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" },
        },
        // B: a blank identity must normalize to null, not ""
        {
          cons_pub_key_bech32: VECTORS[1][0],
          description: { moniker: "StakingCabin", identity: "  " },
        },
        { cons_pub_key_bech32: VECTORS[2][0], description: { moniker: "Node.Monster" } },
        { cons_pub_key_bech32: "garbage", description: { moniker: "X" } }, // bad pubkey
        { cons_pub_key_bech32: VECTORS[0][0], description: { moniker: "  " } }, // blank name
        { operator_bech32: "mezovaloper1nope" }, // no pubkey at all
      ],
    };
    const map = monikersFromLcd(json);
    expect(map.size).toBe(3);
    expect(map.get(A)).toEqual({
      moniker: "voyage-through-time",
      identity: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
    });
    expect(map.get(B)).toEqual({ moniker: "StakingCabin", identity: null });
    expect(map.get(C)).toEqual({ moniker: "Node.Monster", identity: null });
  });

  it("returns an empty map (never throws) for a non-x/poa response", () => {
    expect(monikersFromLcd({ code: 12, message: "Not Implemented" }).size).toBe(0);
    expect(monikersFromLcd(null).size).toBe(0);
  });
});

describe("syncMonikers", () => {
  it("writes monikers onto matching validators and ignores the rest", async () => {
    const map = new Map([
      [A, { moniker: "voyage-through-time", identity: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" }],
      [B, { moniker: "StakingCabin", identity: null }],
      // C deliberately absent: an LCD entry missing for a known validator must
      // not blank the stored name.
    ]);
    const updated = await syncMonikers(db, chainId, map);
    expect(updated).toBe(2);

    const r = await pool.query(
      `select address, moniker, identity from validators where chain_id = $1 order by address`,
      [chainId],
    );
    const byAddr = new Map(r.rows.map((x) => [x.address, x]));
    expect(byAddr.get(A)?.moniker).toBe("voyage-through-time");
    expect(byAddr.get(A)?.identity).toBe("ABCDEF0123456789ABCDEF0123456789ABCDEF01");
    expect(byAddr.get(B)?.moniker).toBe("StakingCabin");
    expect(byAddr.get(B)?.identity).toBeNull();
    expect(byAddr.get(C)?.moniker).toBeNull();

    // Re-running with the same map is a no-op.
    expect(await syncMonikers(db, chainId, map)).toBe(0);
  });

  it("updates a changed moniker but keeps a name the LCD no longer lists", async () => {
    const map = new Map([[A, { moniker: "renamed", identity: null }]]);
    expect(await syncMonikers(db, chainId, map)).toBe(1);
    const r = await pool.query<{ moniker: string }>(
      `select moniker from validators where chain_id = $1 and address = $2`,
      [chainId, A],
    );
    expect(r.rows[0].moniker).toBe("renamed");
    // B is no longer in the map; its stored moniker is untouched.
    const b = await pool.query<{ moniker: string }>(
      `select moniker from validators where chain_id = $1 and address = $2`,
      [chainId, B],
    );
    expect(b.rows[0].moniker).toBe("StakingCabin");
  });

  it("does nothing for an empty map", async () => {
    expect(await syncMonikers(db, chainId, new Map())).toBe(0);
  });
});
