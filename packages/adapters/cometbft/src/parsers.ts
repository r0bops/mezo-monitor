import { z } from "zod";

/**
 * CometBFT 0.38 JSON-RPC response shapes.
 * Verified against the live mezo-archive-01 node (mezo_31612-1) — not from memory.
 * Quirk: CometBFT returns heights / voting_power / proposer_priority as STRINGS.
 */

const PubKey = z.object({ type: z.string(), value: z.string() });

const Signature = z.object({
  block_id_flag: z.number().optional(), // 1=Absent, 2=Commit (signed), 3=Nil (missed)
  validator_address: z.string().optional(),
  timestamp: z.string().optional(),
  signature: z.string().optional(),
});

export const StatusResponse = z.object({
  result: z.object({
    node_info: z.object({ network: z.string(), moniker: z.string(), version: z.string() }),
    sync_info: z.object({
      latest_block_height: z.string(),
      latest_block_time: z.string(),
      earliest_block_height: z.string(),
      catching_up: z.boolean(),
    }),
  }),
});

export const ValidatorsResponse = z.object({
  result: z.object({
    block_height: z.string(),
    validators: z.array(
      z.object({
        address: z.string(),
        pub_key: PubKey,
        voting_power: z.string(),
        proposer_priority: z.string(),
      }),
    ),
    total: z.string(),
    count: z.string(),
  }),
});

export const BlockResponse = z.object({
  result: z.object({
    block_id: z.object({ hash: z.string() }),
    block: z.object({
      header: z.object({
        height: z.string(),
        time: z.string(),
        chain_id: z.string(),
        proposer_address: z.string(),
      }),
      data: z.object({ txs: z.array(z.string()).optional() }).optional(),
      last_commit: z
        .object({
          height: z.string(),
          round: z.number(),
          signatures: z.array(Signature).optional(),
        })
        .optional(), // absent for the genesis block (height 1)
    }),
  }),
});

export type ParsedSignature = { validator_address: string; signed: boolean };

export type ParsedBlock = {
  height: number;
  time: string;
  hash: string;
  proposerAddress: string;
  txCount: number;
  validatorCount: number;
  signatureCount: number;
  /** Height these signatures are committing (block.height - 1). */
  commitHeight: number;
  signatures: ParsedSignature[];
};

/**
 * Parse a `/block` response into what we persist.
 *
 * CometBFT note: a block's `last_commit` contains the signatures for the
 * PREVIOUS block (commitHeight = height - 1). So ingesting block H yields the
 * signing record for H-1. The latest block's signatures arrive one block later.
 */
export function parseBlock(j: unknown): ParsedBlock {
  const r = BlockResponse.parse(j).result;
  const header = r.block.header;
  const txs = r.block.data?.txs ?? [];
  const lastCommit = r.block.last_commit;
  const sigs = lastCommit?.signatures ?? [];
  const blockHeight = Number(header.height);
  const commitHeight = lastCommit?.height ? Number(lastCommit.height) : blockHeight - 1;
  const present = sigs.filter((s) => s.validator_address);
  const signatures: ParsedSignature[] = present.map((s) => ({
    validator_address: s.validator_address!.toLowerCase(),
    signed: s.block_id_flag === 2, // 2 = Commit (signed); 3 = Nil; 1 = Absent
  }));
  return {
    height: blockHeight,
    time: header.time,
    hash: r.block_id.hash,
    proposerAddress: header.proposer_address.toLowerCase(),
    txCount: txs.length,
    validatorCount: present.length,
    signatureCount: signatures.filter((s) => s.signed).length,
    commitHeight,
    signatures,
  };
}
