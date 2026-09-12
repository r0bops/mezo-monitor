/**
 * Tests for the Matchbox identity path: the hex-pubkey consensus address
 * derivation (checked against the chain's own addresses), list parsing, and
 * the DB sync semantics (avatar only where a profile exists; nothing
 * blanked for validators Matchbox doesn't know).
 *
 * The vectors are real mainnet values from
 * https://app.matchbox.markets/api/validators/mainnet so the derivation is
 * tested against the chain, not a self-consistent fixture.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@mezo/core";
import { createTestDb, dropTestDb, seed } from "../../../api/test/setup.js";
import {
  consensusAddressFromHex,
  matchboxAvatars,
  matchboxValidators,
  syncMatchbox,
} from "../src/matchbox.js";

// Real: Node.Monster's consensus key on-chain is 143e66af…, Simply Staking's
// is 3380732a… (both verified against the indexed set).
const NODE_MONSTER_PUB =
  "0x7e3e7e8c4459958ae6dff2535bd474a833a32b2bca6ac2bd67bfc5e2e068713d";
const VOYAGE_PUB = "0xc27a9a8135d9e015aa14b406db637e2d93fcb90823d3a51058d9781985f3d1c3";

const A = "143e66afe2a69bc2a4a2b3a088e82ed007e06f1b"; // Node.Monster
const B = "5addd2eaac2cd5fa43ba5c62433912807215474a"; // voyage-through-time
const C = "919f0ac3136ce30a326bf5f549d10ea6cf598159"; // StakingCabin

const apiJson = {
  data: [
    {
      operator: "0x1ABd621Cd9D76663991C46230E712A96265ba6F4",
      consensusPublicKey: NODE_MONSTER_PUB,
      moniker: "Node.Monster",
      gauge: "0x29fAa7e91A18217CD603b84Ce946834bDa545B15",
    },
    {
      operator: "0x000069bb6d685d21a1D8E79401EA4bC275cF5910",
      consensusPublicKey: VOYAGE_PUB,
      moniker: "voyage-through-time",
      gauge: "0xf84b0ab58Bd7D72D648B59848Af42a84dBE3D033",
    },
    { operator: "0xnope", moniker: "NoKey" }, // no pubkey — must be skipped
  ],
};

const profilesJson = [
  // Only voyage's gauge has a profile picture in this fixture.
  {
    gauge_address: "0xf84b0ab58bd7d72d648b59848af42a84dbe3d033",
    profile_picture_url: "https://xyeyuamvydligyjgzqnt.supabase.co/storage/v1/object/public/gauge-avatars/validators/31612/0xf84b.png",
  },
  { gauge_address: "0x29faa7e91a18217cd603b84ce946834bda545b15", profile_picture_url: null },
];

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let chainId: number;

beforeAll(async () => {
  pool = await createTestDb();
  db = drizzle(pool, { schema });
  chainId = await seed(pool, {
    head: 100,
    count: 10,
    validators: [A, B, C],
    monikers: { [A]: "Node.Monster", [B]: "voyage-through-time", [C]: "StakingCabin" },
  });
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

describe("consensusAddressFromHex", () => {
  it("derives the chain's own addresses from the matchbox pubkeys", () => {
    expect(consensusAddressFromHex(NODE_MONSTER_PUB)).toBe(A);
    expect(consensusAddressFromHex(VOYAGE_PUB)).toBe(B);
  });

  it("rejects malformed keys rather than guessing", () => {
    expect(() => consensusAddressFromHex("0x1234")).toThrow();
    expect(() => consensusAddressFromHex("nothex")).toThrow();
  });
});

describe("parsers", () => {
  it("maps well-formed entries and skips keyless ones", () => {
    const m = matchboxValidators(apiJson);
    expect(m.size).toBe(2);
    expect(m.get(A)?.moniker).toBe("Node.Monster");
    expect(m.get(B)?.gauge).toBe("0xf84b0ab58bd7d72d648b59848af42a84dbe3d033");
  });

  it("collects avatars only where a picture exists", () => {
    const a = matchboxAvatars(profilesJson);
    expect(a.size).toBe(1);
    expect(a.get("0xf84b0ab58bd7d72d648b59848af42a84dbe3d033")).toContain("supabase");
  });
});

describe("syncMatchbox", () => {
  it("writes the avatar where a profile exists and touches nothing else", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(apiJson) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(profilesJson) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(apiJson) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(profilesJson) });
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncMatchbox(db, chainId);
    // monikers already match the fixture → 0 moniker writes; one avatar write.
    expect(r).toEqual({ monikers: 0, avatars: 1 });

    const rows = await pool.query(
      `select address, avatar_url from validators where chain_id = $1`,
      [chainId],
    );
    const byAddr = new Map(rows.rows.map((x) => [x.address, x.avatar_url]));
    expect(byAddr.get(A)).toBeNull(); // profile exists but has no picture
    expect(byAddr.get(B)).toContain("supabase");
    expect(byAddr.get(C)).toBeNull(); // not listed by matchbox at all — untouched

    // Idempotent: a second sync writes nothing.
    const again = await syncMatchbox(db, chainId);
    expect(again).toEqual({ monikers: 0, avatars: 0 });
    vi.unstubAllGlobals();
  });
});
