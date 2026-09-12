/**
 * Validator identity + logos from Matchbox (app.matchbox.markets).
 *
 * Matchbox runs Mezo's vote-incentive gauges and publishes the validator
 * list at /api/validators/mainnet — crucially including each validator's
 * consensus PUBLIC KEY, so the join onto our indexed validators is the same
 * deterministic sha256 derivation CometBFT uses, not a name guess. Profile
 * pictures (and curated display names) live in Matchbox's public Supabase:
 * keyed by gauge address, exact URLs with the right extension.
 *
 * This is a third-party dependency used fail-soft and best-effort, exactly
 * like the LCD moniker path: a dead Matchbox keeps whatever was last synced
 * and the dashboard's identicon fallback covers validators it never knew.
 * The chain's own identity (LCD description.identity → Keybase) still takes
 * precedence when present; Matchbox fills the gap the dead LCD left.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { validators } from "@mezo/core";
import type { Database } from "@mezo/core";

const VALIDATORS_URL = "https://app.matchbox.markets/api/validators/mainnet";
const PROFILES_URL =
  "https://xyeyuamvydligyjgzqnt.supabase.co/rest/v1/validator_profiles?select=*&chain_id=eq.31612";
/**
 * Supabase anon key as shipped in Matchbox's own JS bundle — a public
 * read-only credential every site visitor's browser already sends, not a
 * secret. Overridable in case it rotates.
 */
const SUPABASE_ANON_KEY =
  process.env.MATCHBOX_SUPABASE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5ZXl1YW12eWRsaWd5amd6cW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MDczNjcsImV4cCI6MjA4MTM4MzM2N30.BA74evDPMDDwij9AhYOx0G178TSg7OzOK9wSh0L31Lw";

const TIMEOUT_MS = 10_000;

/** Consensus address (lowercase hex) from a 0x-prefixed ed25519 pubkey. */
export function consensusAddressFromHex(pubkeyHex: string): string {
  const pk = pubkeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(pk) || pk.length !== 64) throw new Error("not a 0x ed25519 pubkey");
  return createHash("sha256").update(Buffer.from(pk, "hex")).digest().subarray(0, 20).toString("hex");
}

type MatchboxValidator = {
  operator?: unknown;
  consensusPublicKey?: unknown;
  moniker?: unknown;
  gauge?: unknown;
};

/** Extract lowercase consensus address → {moniker, gauge} from the API list. */
export function matchboxValidators(json: unknown): Map<string, { moniker: string; gauge: string }> {
  const out = new Map<string, { moniker: string; gauge: string }>();
  const list = (json as { data?: unknown })?.data;
  if (!Array.isArray(list)) return out;
  for (const v of list as MatchboxValidator[]) {
    if (typeof v?.consensusPublicKey !== "string" || typeof v?.moniker !== "string") continue;
    if (typeof v?.gauge !== "string") continue;
    try {
      out.set(consensusAddressFromHex(v.consensusPublicKey), {
        moniker: v.moniker.trim(),
        gauge: v.gauge.toLowerCase(),
      });
    } catch {
      // a malformed entry must not sink the list
    }
  }
  return out;
}

/** gauge address (lowercase) → profile picture URL, only where one exists. */
export function matchboxAvatars(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(json)) return out;
  for (const p of json as { gauge_address?: unknown; profile_picture_url?: unknown }[]) {
    if (typeof p?.gauge_address !== "string" || typeof p?.profile_picture_url !== "string") continue;
    if (!/^https:\/\//i.test(p.profile_picture_url)) continue;
    out.set(p.gauge_address.toLowerCase(), p.profile_picture_url);
  }
  return out;
}

/**
 * Sync monikers and avatar URLs onto the indexed validators. Returns the
 * number of rows touched. A validator Matchbox doesn't list, or one with no
 * profile picture, is simply left alone — never blanked.
 */
export async function syncMatchbox(
  db: Database,
  chainId: number,
): Promise<{ monikers: number; avatars: number }> {
  const [vRes, pRes] = await Promise.all([
    fetch(VALIDATORS_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }),
    fetch(PROFILES_URL, {
      headers: { accept: "application/json", apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  ]);
  if (!vRes.ok) throw new Error(`matchbox validators: HTTP ${vRes.status}`);
  if (!pRes.ok) throw new Error(`matchbox profiles: HTTP ${pRes.status}`);
  const list = matchboxValidators(await vRes.json());
  const avatars = matchboxAvatars(await pRes.json());

  const rows = await db
    .select({
      id: validators.id,
      address: validators.address,
      moniker: validators.moniker,
      avatarUrl: validators.avatarUrl,
    })
    .from(validators)
    .where(eq(validators.chainId, chainId));

  let monikers = 0;
  let avatarN = 0;
  for (const r of rows) {
    const m = list.get(r.address.toLowerCase());
    if (!m) continue;
    const avatar = avatars.get(m.gauge) ?? null;
    const set: { moniker?: string; avatarUrl?: string | null; updatedAt: Date } = { updatedAt: new Date() };
    let touch = false;
    if (m.moniker !== "" && m.moniker !== r.moniker) {
      set.moniker = m.moniker;
      monikers++;
      touch = true;
    }
    if (avatar !== r.avatarUrl) {
      set.avatarUrl = avatar;
      avatarN++;
      touch = true;
    }
    if (touch) {
      await db.update(validators).set(set).where(eq(validators.id, r.id));
    }
  }
  return { monikers, avatars: avatarN };
}
