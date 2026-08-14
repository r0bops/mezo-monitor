/**
 * Endpoint config resolution.
 *
 * `interpolate()` turns an unset ${VAR} into an empty string, so a missing
 * environment variable would otherwise register a blank URL that fails every
 * probe forever. These lock in that such endpoints are dropped loudly instead.
 */
import { describe, expect, it } from "vitest";
import { resolveEndpoints } from "../src/config";

const base = {
  slug: "test",
  name: "Test",
  chain_id: "test_1-1",
  family: "cometbft" as const,
  rpc_url: "http://primary:26657",
  ws_url: "ws://primary:26657/websocket",
  capabilities: { delegations: false, governance: false, slashing: false, poa: true },
};

describe("resolveEndpoints", () => {
  it("falls back to the top-level rpc_url when no list is given", () => {
    const out = resolveEndpoints(base);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("default");
    expect(out[0].rpc_url).toBe("http://primary:26657");
    expect(out[0].ws_url).toBe("ws://primary:26657/websocket");
  });

  it("uses the endpoints list when present", () => {
    const out = resolveEndpoints({
      ...base,
      endpoints: [
        { label: "a", rpc_url: "http://a:26657", priority: 5 },
        { label: "b", rpc_url: "http://b:26657" },
      ],
    });
    expect(out.map((e) => e.label)).toEqual(["a", "b"]);
    expect(out[0].priority).toBe(5);
  });

  it("assigns increasing default priorities in declaration order", () => {
    const out = resolveEndpoints({
      ...base,
      endpoints: [
        { label: "a", rpc_url: "http://a:26657" },
        { label: "b", rpc_url: "http://b:26657" },
      ],
    });
    expect(out[0].priority).toBeLessThan(out[1].priority);
  });

  it("drops an endpoint whose ${VAR} did not resolve", () => {
    // YAML parses an empty interpolated value as null, not "", so both forms
    // must be handled — null is what actually reaches us from a real config.
    const out = resolveEndpoints({
      ...base,
      endpoints: [
        { label: "primary", rpc_url: "http://a:26657" },
        { label: "empty", rpc_url: "" },
        { label: "null", rpc_url: null },
        { label: "missing" },
      ],
    });
    expect(out.map((e) => e.label)).toEqual(["primary"]);
  });

  it("keeps the endpoint but drops an unresolved ws_url", () => {
    // HTTP polling still works without a socket, so this is not fatal.
    const out = resolveEndpoints({
      ...base,
      endpoints: [{ label: "a", rpc_url: "http://a:26657", ws_url: null }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].ws_url).toBe("");
  });

  it("throws when nothing usable remains", () => {
    expect(() =>
      resolveEndpoints({ ...base, endpoints: [{ label: "a", rpc_url: "" }] }),
    ).toThrow(/no usable RPC endpoints/);
  });
});
