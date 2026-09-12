/**
 * Consensus pipeline: the newest blocks as a strip, NEWEST ON THE LEFT so
 * the live edge is always visible without scrolling — history extends to
 * the right. Who proposed, who voted, whether the chain needed extra
 * rounds. Modelled on monatlas (docs/ui-references.md). Every block here
 * is already committed, so each card is FINALIZED by definition; the
 * interesting signal is the round badge: round 0 is the happy path,
 * round > 0 means the proposer was slow or absent and the chain retried.
 */
import { useEffect, useState } from "react";
import type { PipelineBlock as Block } from "../api";
import { getPipeline } from "../api";
import { ValidatorAvatar } from "./ui";
import { agoFrom, fmt, short } from "../lib";
import { BRAND, OK, TX, TX2, TX3, WARN, mono, panel, sans } from "./ui";

const POLL_MS = 10_000;

export function Pipeline({ live }: { live: boolean }) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getPipeline()
        .then((r) => {
          if (!cancelled) {
            setBlocks(r.blocks);
            setError(null);
          }
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    void load();
    if (!live) return;
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live]);

  return (
    <section style={{ ...panel, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>Consensus pipeline</h2>
        <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
          {error
            ? `unavailable (${error})`
            : blocks
              ? `newest ${blocks.length} blocks · newest on the left`
              : "loading…"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          padding: "12px 16px 14px",
          overflowX: "auto",
        }}
      >
        {(blocks ?? []).slice().reverse().map((b, i) => (
          <div key={b.height} style={{ display: "flex", alignItems: "stretch", flex: "none" }}>
            {i > 0 && <div style={arrowStyle}>→</div>}
            <BlockCard b={b} newest={i === 0} />
          </div>
        ))}
        {blocks?.length === 0 && (
          <span style={{ font: `400 11.5px/1 ${sans}`, color: TX3 }}>
            No blocks indexed yet — the pipeline fills as the first blocks arrive.
          </span>
        )}
      </div>
    </section>
  );
}

function BlockCard({ b, newest }: { b: Block; newest: boolean }) {
  const slow = (b.round ?? 0) > 0;
  const missedVotes = b.votes.total !== null && b.votes.signed !== null && b.votes.signed < b.votes.total;
  return (
    <div
      title={`block ${fmt(b.height)}\nproposed by ${b.proposer?.moniker ?? b.proposer?.address ?? "unknown"}\n` +
        `votes: ${b.votes.signed ?? "—"}/${b.votes.total ?? "—"}${slow ? `\nneeded ${b.round} extra round(s)` : ""}\n` +
        `${agoFrom(b.time)} ago`}
      style={{
        minWidth: 168,
        maxWidth: 190,
        padding: "9px 11px",
        borderRadius: 10,
        border: `1px solid ${newest ? "var(--brand)" : "var(--line)"}`,
        background: slow ? "var(--warnSoft)" : "var(--panel2)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {b.proposer ? (
          <>
            <ValidatorAvatar
              address={b.proposer.address}
              avatarUrl={b.proposer.avatar_url}
              title={b.proposer.moniker ?? undefined}
              size={16}
            />
            <span
              style={{
                font: `500 10.5px/1 ${sans}`,
                color: TX,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {b.proposer.moniker ?? short(b.proposer.address)}
            </span>
          </>
        ) : (
          <span style={{ font: `500 10.5px/1 ${sans}`, color: TX3 }}>unknown proposer</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, font: `500 10.5px/1 ${mono}` }}>
        <span style={{ color: newest ? BRAND : TX2 }}>#{fmt(b.height)}</span>
        <span style={{ color: missedVotes ? WARN : OK, marginLeft: "auto" }}>
          {b.votes.signed ?? "—"}/{b.votes.total ?? "—"} ✓
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, font: `400 9.5px/1 ${sans}`, color: TX3 }}>
        {slow ? (
          <span
            style={{
              padding: "2px 6px",
              borderRadius: 5,
              background: "var(--warnSoft)",
              color: WARN,
              fontWeight: 600,
            }}
          >
            ROUND {b.round}
          </span>
        ) : (
          <span style={{ color: OK, fontWeight: 600 }}>FINALIZED</span>
        )}
        <span style={{ marginLeft: "auto" }}>
          {b.tx_count ?? 0} tx · {agoFrom(b.time)}
        </span>
      </div>
    </div>
  );
}

const arrowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 7px",
  font: `400 12px/1 ${mono}`,
  color: TX3,
};
