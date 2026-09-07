/**
 * Validator logo resolution from Keybase identities.
 *
 * A Cosmos-style `description.identity` is a Keybase key suffix (64-hex);
 * Keybase's public lookup returns the operator's chosen avatar. Logos change
 * rarely, so results are cached for a day and coalesced — a dashboard refresh
 * costs at most one lookup per identity per day.
 *
 * Fail-soft by design: an unreachable Keybase or an identity nobody registered
 * resolves to null, which the dashboard renders as a generated identicon, never
 * as a blank or a fabricated image.
 */
import { CacheMap } from "./cache";

const KEYBASE_LOOKUP = "https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=";
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;

type KeybasePicture = { url?: unknown };
type KeybaseUser = { pictures?: { primary?: KeybasePicture } };
type KeybaseResponse = { them?: KeybaseUser[] };

/**
 * Resolve one identity to an avatar URL, or null. Errors return null (and are
 * cached as such for the TTL) so a Keybase outage cannot fail API requests.
 */
export function createAvatarResolver(): (identity: string) => Promise<string | null> {
  const cache = new CacheMap(async (identity: string): Promise<string | null> => {
    try {
      const res = await fetch(KEYBASE_LOOKUP + encodeURIComponent(identity), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as KeybaseResponse;
      const url = json?.them?.[0]?.pictures?.primary?.url;
      return typeof url === "string" && url.startsWith("https://") ? url : null;
    } catch {
      return null;
    }
  }, AVATAR_TTL_MS);
  return (identity: string) => cache.get(identity);
}

/**
 * Attach `avatar_url` to each row, resolving each distinct identity once.
 * Rows without an identity (or whose identity resolves to nothing) get null.
 */
export async function withAvatars<T extends { identity: string | null }>(
  rows: T[],
  resolve: (identity: string) => Promise<string | null>,
): Promise<(T & { avatar_url: string | null })[]> {
  const identities = [...new Set(rows.map((r) => r.identity).filter((x): x is string => x !== null))];
  const urls = new Map<string, string | null>(
    await Promise.all(identities.map(async (id) => [id, await resolve(id)] as const)),
  );
  return rows.map((r) => ({ ...r, avatar_url: r.identity === null ? null : (urls.get(r.identity) ?? null) }));
}
