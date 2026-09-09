/**
 * Moniker sync from the chain's LCD.
 *
 * CometBFT's /validators carries no monikers — only consensus address, pubkey
 * and power. Mezo is PoA with no x/staking module, but its custom x/poa module
 * exposes `GET {lcd_url}/poa/v1/validators`, whose entries carry the consensus
 * pubkey (bech32, amino-prefixed) and a description.moniker. The consensus
 * address is a deterministic function of the ed25519 pubkey
 * (sha256(key)[:20]), so the LCD list can be joined onto the indexed
 * validators offline — no trust in the LCD beyond a name, and a wrong-chain
 * response cannot poison the mapping because the addresses simply won't match.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { validators } from "@mezo/core";
import type { Database } from "@mezo/core";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

/** Decode a bech32/bech32m string to (hrp, 8-bit payload). Throws on bad data. */
export function bech32Decode(addr: string): { hrp: string; data: Uint8Array } {
  const pos = addr.lastIndexOf("1");
  if (pos < 1 || pos + 7 > addr.length) throw new Error("invalid bech32 separator");
  const hrp = addr.slice(0, pos);
  const values: number[] = [];
  for (const c of addr.slice(pos + 1)) {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error(`invalid bech32 character "${c}"`);
    values.push(v);
  }
  const hrpExpand = [...hrp]
    .map((c) => c.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const chk = polymod([...hrpExpand, ...values]);
  if (chk !== 1 && chk !== BECH32M_CONST) throw new Error("bech32 checksum mismatch");

  const data5 = values.slice(0, -6);
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const v of data5) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) throw new Error("invalid bech32 padding");
  return { hrp, data: Uint8Array.from(out) };
}

/**
 * Consensus address (uppercase hex) for an amino-prefixed ed25519 bech32
 * pubkey, e.g. mezovalconspub1… → sha256(raw key)[:20]. Same derivation
 * CometBFT itself uses, so the result matches /validators addresses and block
 * proposer addresses byte for byte.
 */
export function consensusAddress(pubkeyBech32: string): string {
  const { data } = bech32Decode(pubkeyBech32);
  if (data.length < 32) throw new Error("pubkey payload shorter than an ed25519 key");
  const key = data.slice(data.length - 32);
  return createHash("sha256").update(key).digest().subarray(0, 20).toString("hex").toUpperCase();
}

type LcdValidator = {
  cons_pub_key_bech32?: unknown;
  description?: { moniker?: unknown; identity?: unknown };
};

/** What the indexer can learn about a validator from its x/poa LCD entry. */
export type LcdInfo = { moniker: string; identity: string | null };

/** Extract a lowercase consensus address → {moniker, identity} map from an LCD response. */
export function monikersFromLcd(json: unknown): Map<string, LcdInfo> {
  const out = new Map<string, LcdInfo>();
  const list = (json as { validators?: unknown })?.validators;
  if (!Array.isArray(list)) return out;
  for (const v of list as LcdValidator[]) {
    if (typeof v?.cons_pub_key_bech32 !== "string") continue;
    const moniker = v?.description?.moniker;
    if (typeof moniker !== "string" || moniker.trim() === "") continue;
    const identity =
      typeof v?.description?.identity === "string" && v.description.identity.trim() !== ""
        ? v.description.identity.trim()
        : null;
    try {
      out.set(consensusAddress(v.cons_pub_key_bech32).toLowerCase(), {
        moniker: moniker.trim(),
        identity,
      });
    } catch {
      // A malformed entry must not sink the rest of the list.
    }
  }
  return out;
}

/**
 * Persist monikers and Keybase identities onto the indexed validators. Only
 * rows where something actually changed are written; addresses are matched
 * case-insensitively (CometBFT reports uppercase, the indexer stores lowercase).
 */
export async function syncMonikers(
  db: Database,
  chainId: number,
  monikers: Map<string, LcdInfo>,
): Promise<number> {
  if (monikers.size === 0) return 0;
  const rows = await db
    .select({ address: validators.address, moniker: validators.moniker, identity: validators.identity })
    .from(validators)
    .where(eq(validators.chainId, chainId));
  let updated = 0;
  for (const r of rows) {
    const info = monikers.get(r.address.toLowerCase());
    if (info === undefined) continue;
    if (info.moniker === r.moniker && info.identity === r.identity) continue;
    await db
      .update(validators)
      .set({ moniker: info.moniker, identity: info.identity, updatedAt: new Date() })
      .where(and(eq(validators.chainId, chainId), eq(validators.address, r.address)));
    updated++;
  }
  return updated;
}

/** Fetch + parse the x/poa validator list from one LCD. */
export async function fetchMonikersFrom(lcdUrl: string): Promise<Map<string, LcdInfo>> {
  const url = lcdUrl.replace(/\/+$/, "") + "/poa/v1/validators";
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`LCD ${url}: HTTP ${res.status}`);
  return monikersFromLcd(await res.json());
}

/**
 * Fetch the validator list, trying each LCD in order until one answers.
 * Returns the URL that succeeded so the caller can prefer it next time; the
 * address join already discards a wrong-chain response, so trying another
 * provider cannot poison the mapping.
 */
export async function fetchMonikers(
  lcdUrls: string[],
  prefer?: string,
): Promise<{ info: Map<string, LcdInfo>; url: string }> {
  const ordered = prefer && lcdUrls.includes(prefer) ? [prefer, ...lcdUrls.filter((u) => u !== prefer)] : lcdUrls;
  const errors: string[] = [];
  for (const url of ordered) {
    try {
      return { info: await fetchMonikersFrom(url), url };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`no LCD answered (${errors.join("; ")})`);
}
