/**
 * Tests for Keybase avatar resolution: the happy path, the fail-soft paths
 * (unknown identity, HTTP error, network error, malformed body) and the
 * distinct-identity coalescing of withAvatars. fetch is stubbed so the tests
 * assert the parsing, not Keybase's uptime.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAvatarResolver, withAvatars } from "../src/avatars.js";

const ID = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
const AVATAR = "https://s3.amazonaws.com/keybase_processed_uploads/somephoto.jpg";

function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const f = vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("createAvatarResolver", () => {
  it("returns the primary picture URL for a registered identity", async () => {
    stubFetch({ status: { code: 0, name: "OK" }, them: [{ pictures: { primary: { url: AVATAR } } }] });
    const resolve = createAvatarResolver();
    await expect(resolve(ID)).resolves.toBe(AVATAR);
  });

  it("resolves null for an identity nobody registered", async () => {
    stubFetch({ status: { code: 0, name: "OK" }, them: [] });
    await expect(createAvatarResolver()(ID)).resolves.toBeNull();
  });

  it("resolves null for a non-https picture URL", async () => {
    stubFetch({ them: [{ pictures: { primary: { url: "http://insecure.example/x.png" } } }] });
    await expect(createAvatarResolver()(ID)).resolves.toBeNull();
  });

  it("resolves null on an HTTP error rather than throwing", async () => {
    stubFetch({ error: "rate limited" }, 429);
    await expect(createAvatarResolver()(ID)).resolves.toBeNull();
  });

  it("resolves null when the network call itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT")));
    await expect(createAvatarResolver()(ID)).resolves.toBeNull();
  });

  it("caches: a repeated identity within the TTL costs one lookup", async () => {
    const f = stubFetch({ them: [{ pictures: { primary: { url: AVATAR } } }] });
    const resolve = createAvatarResolver();
    await resolve(ID);
    await resolve(ID);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("withAvatars", () => {
  it("attaches avatar_url per row, resolving each distinct identity once", async () => {
    const f = stubFetch({ them: [{ pictures: { primary: { url: AVATAR } } }] });
    const rows = [
      { address: "a1", identity: ID },
      { address: "a2", identity: ID },
      { address: "a3", identity: null },
    ];
    const out = await withAvatars(rows, createAvatarResolver());
    expect(out).toEqual([
      { address: "a1", identity: ID, avatar_url: AVATAR },
      { address: "a2", identity: ID, avatar_url: AVATAR },
      { address: "a3", identity: null, avatar_url: null },
    ]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
