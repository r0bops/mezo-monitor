/**
 * Regression test for the null-signature stall.
 *
 * The first time a Mezo validator missed a block (2026-08-15, ~13h after the
 * operator's node returned), every /block parse failed: CometBFT encodes a
 * non-signer as { signature: null, block_id_flag: 1|3 }, and the schema only
 * tolerated an absent key, not an explicit null. Ingestion stopped until the
 * next miss-free era — which never came.
 */
import { describe, expect, it } from "vitest";
import { parseBlock } from "../src/parsers.js";

/** Minimal /block response, shaped like CometBFT 0.38 with string heights. */
function block(over: {
  height: number;
  signatures: unknown[];
}) {
  return {
    result: {
      block_id: { hash: `HASH${over.height}` },
      block: {
        header: {
          height: String(over.height),
          time: "2026-08-15T06:02:30Z",
          chain_id: "mezo_31612-1",
          proposer_address: "ABC0000000000000000000000000000000000001",
        },
        data: { txs: [] },
        last_commit: {
          height: String(over.height - 1),
          round: 0,
          signatures: over.signatures,
        },
      },
    },
  };
}

const SIGNED = {
  block_id_flag: 2,
  validator_address: "AAA0000000000000000000000000000000000001",
  timestamp: "2026-08-15T06:02:29Z",
  signature: "c2lnbmVk",
};
const MISSED_NULL = {
  block_id_flag: 3,
  validator_address: "BBB0000000000000000000000000000000000002",
  timestamp: "0001-01-01T00:00:00Z",
  signature: null, // <- what stalled ingestion
};
const ABSENT = {
  block_id_flag: 1,
  validator_address: null,
  timestamp: "0001-01-01T00:00:00Z",
  signature: null,
};

describe("parseBlock", () => {
  it("accepts a commit containing null signatures and counts them as misses", () => {
    const p = parseBlock(block({ height: 100, signatures: [SIGNED, MISSED_NULL, ABSENT] }));
    expect(p.signatureCount).toBe(1);
    expect(p.validatorCount).toBe(2); // absent entries carry no address
    expect(p.signatures).toEqual([
      { validator_address: SIGNED.validator_address.toLowerCase(), signed: true },
      { validator_address: MISSED_NULL.validator_address.toLowerCase(), signed: false },
    ]);
  });

  it("attributes the signatures to the previous block (commit height)", () => {
    const p = parseBlock(block({ height: 100, signatures: [SIGNED] }));
    expect(p.height).toBe(100);
    expect(p.commitHeight).toBe(99);
  });

  it("handles a block with no last_commit (genesis)", () => {
    const genesis = {
      result: {
        block_id: { hash: "GEN" },
        block: {
          header: {
            height: "1",
            time: "2025-01-01T00:00:00Z",
            chain_id: "mezo_31612-1",
            proposer_address: "",
          },
        },
      },
    };
    const p = parseBlock(genesis);
    expect(p.signatures).toEqual([]);
    expect(p.validatorCount).toBe(0);
  });
});
