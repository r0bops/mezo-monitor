import { describe, expect, it } from "vitest";
import { rpcUrl } from "../src/nodeRpc";

describe("rpcUrl", () => {
  it("strips trailing slashes from the base", () => {
    expect(rpcUrl("https://node.example///", "/status")).toBe(
      "https://node.example/status",
    );
  });

  it("encodes path params", () => {
    expect(rpcUrl("https://node.example", "/validators", { height: 123, page: 2, per_page: 30 })).toBe(
      "https://node.example/validators?height=123&page=2&per_page=30",
    );
  });

  it("passes height=latest through as a string param", () => {
    expect(rpcUrl("https://node.example", "/block", { height: "latest" })).toBe(
      "https://node.example/block?height=latest",
    );
  });

  it("omits the query string when no params are given", () => {
    expect(rpcUrl("http://127.0.0.1:26657", "/net_info")).toBe(
      "http://127.0.0.1:26657/net_info",
    );
  });
});
