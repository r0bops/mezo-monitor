/**
 * Consensus pipeline: the newest blocks as a strip, NEWEST ON THE LEFT so
 * the live edge is always visible without scrolling — history extends to
 * the right. Who proposed, who voted, whether the chain needed extra
 * rounds. Modelled on monatlas (docs/ui-references.md). Every block here
 * is already committed, so each card is FINALIZED by definition; the
 * interesting signal is the round badge: round 0 is the happy path,
 * round > 0 means the proposer was slow or absent and the chain retried.
 */
import { useEffect, useRef, useState } from "react";
import type { PipelineBlock as Block } from "../api";
import { getPipeline } from "../api";
import { ValidatorAvatar } from "./ui";
import { agoFrom, fmt, short } from "../lib";
import { BRAND, TX, TX3, WARN, mono, panel, sans } from "./ui";

const POLL_MS = 10_000;

export function Pipeline({ live }: { live: boolean }) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [animationCycle, setAnimationCycle] = useState(0);
  const [freshHeight, setFreshHeight] = useState<number | null>(null);
  const previousHead = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getPipeline()
        .then((r) => {
        if (!cancelled) {
            setBlocks(r.blocks);
            setError(null);
            // The API keeps the pipeline in chronological order; the render
            // reverses it so the newest block is on the left.
            const head = r.blocks[r.blocks.length - 1]?.height ?? null;
            if (head !== null && previousHead.current !== null && head !== previousHead.current) {
              setFreshHeight(head);
              setAnimationCycle((cycle) => cycle + 1);
              const proposer = r.blocks[r.blocks.length - 1]?.proposer?.address;
              if (proposer) {
                window.dispatchEvent(
                  new CustomEvent("mezo:block-produced", { detail: { address: proposer, height: head } }),
                );
              }
              window.setTimeout(() => setFreshHeight((current) => (current === head ? null : current)), 1800);
            }
            if (head !== null) previousHead.current = head;
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
    <section className="pipeline-panel" style={{ ...panel, overflow: "hidden" }}>
      <div
        className="pipeline-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: 0, font: `650 13px/1 ${sans}`, color: TX }}><span className="pipeline-title-desktop">Recent Blocks / Consensus Pipeline</span><span className="pipeline-title-mobile">Recent Blocks</span></h2>
          <span style={{ font: `400 10px/1 ${sans}`, color: TX3 }}>Latest blocks and their validators — newest on the left.</span>
        </div>
        <span className="pipeline-meta" style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
          {error
            ? `unavailable (${error})`
            : blocks
              ? `newest ${blocks.length} blocks · newest on the left`
              : "loading…"}
        </span>
        <a className="pipeline-view-all" href="#/blocks">View all&nbsp; →</a>
      </div>
      <div
        className="pipeline-track"
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          padding: "12px 16px 14px",
          overflowX: "auto",
        }}
      >
        {(blocks ?? []).slice().reverse().map((b, i) => (
          <div
            key={`${b.height}-${animationCycle}`}
            className={`pipeline-item ${b.height === freshHeight ? "pipeline-item-new" : animationCycle > 0 ? "pipeline-item-shift" : ""}`}
            style={{ display: "flex", alignItems: "stretch", flex: "none" }}
          >
            {i > 0 && <div className="pipeline-arrow" style={arrowStyle}>→</div>}
            <BlockCard b={b} newest={i === 0} fresh={b.height === freshHeight} />
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

function BlockCard({ b, newest, fresh }: { b: Block; newest: boolean; fresh: boolean }) {
  const slow = (b.round ?? 0) > 0;
  const missedVotes = b.votes.total !== null && b.votes.signed !== null && b.votes.signed < b.votes.total;
  return (
    <div
      title={`block ${fmt(b.height)}\nproposed by ${b.proposer?.moniker ?? b.proposer?.address ?? "unknown"}\n` +
        `votes: ${b.votes.signed ?? "—"}/${b.votes.total ?? "—"}${slow ? `\nneeded ${b.round} extra round(s)` : ""}\n` +
        `${agoFrom(b.time)} ago`}
      className={fresh ? "pipeline-card pipeline-card-new" : "pipeline-card"}
      style={{
        minWidth: 198,
        maxWidth: 220,
        minHeight: 76,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${newest ? "var(--brand)" : "var(--line)"}`,
        background: slow ? "var(--warnSoft)" : "var(--panel2)",
        display: "grid",
        gridTemplateColumns: "38px minmax(0,1fr) auto",
        columnGap: 10,
        alignItems: "center",
      }}
    >
      <div className="pipeline-logo">
        {b.proposer ? (
          <ValidatorAvatar
            address={b.proposer.address}
            avatarUrl={b.proposer.avatar_url}
            title={b.proposer.moniker ?? undefined}
            size={36}
          />
        ) : (
          <span className="pipeline-logo-fallback">◇</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span style={{ color: newest ? BRAND : TX, font: `600 10.5px/1 ${mono}` }}>#{fmt(b.height)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {b.proposer ? (
            <span
              style={{
                font: `600 10.5px/1 ${sans}`,
                color: TX,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {b.proposer.moniker ?? short(b.proposer.address)}
            </span>
          ) : <span style={{ color: TX3 }}>unknown proposer</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, font: `400 9.5px/1 ${sans}`, color: TX3 }}>
          <span>{b.tx_count ?? 0} tx · {agoFrom(b.time)} ago</span>
          {slow && <span style={{ color: WARN }}>R{b.round}</span>}
          {missedVotes && <span style={{ color: WARN, marginLeft: "auto" }}>{b.votes.signed}/{b.votes.total}</span>}
        </div>
      </div>
      <span className="pipeline-chevron" aria-hidden="true">›</span>
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
