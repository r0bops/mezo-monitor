import { useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getBlocks, type PipelineBlock } from "../api";
import { agoFrom, fmt, short } from "../lib";
import { Label, StatusPill, ValidatorAvatar, panel, TX, TX2, TX3, OK, WARN, sans } from "../components/ui";

export function Blocks({ d, live }: { d: Dashboard; live: boolean }) {
  const [blocks, setBlocks] = useState<PipelineBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => getBlocks(50).then((r) => {
      if (!cancelled) { setBlocks(r.blocks); setError(null); setLoading(false); }
    }).catch((e: Error) => {
      if (!cancelled) { setError(e.message); setLoading(false); }
    });
    void load();
    if (!live) return () => { cancelled = true; };
    const timer = window.setInterval(load, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [live]);

  const explorer = d.net?.chain.blockscout_url?.replace(/\/$/, "") ?? null;
  return (
    <div className="blocks-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section style={{ ...panel, padding: "18px 18px 16px" }}>
        <div className="page-intro-row" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <Label>Indexed chain history</Label>
            <h2 style={{ margin: "7px 0 4px", font: `650 18px/1.2 ${sans}`, color: TX }}>Recent Blocks</h2>
            <p style={{ margin: 0, font: `400 12px/1.4 ${sans}`, color: TX2 }}>Committed blocks observed by the Mezo monitor, newest first.</p>
          </div>
          <span style={{ color: live ? OK : TX3, font: `600 10px/1 ${sans}`, padding: "6px 9px", borderRadius: 999, background: live ? "var(--okSoft)" : "var(--panel2)" }}>{live ? "Live updates" : "Paused"}</span>
        </div>
      </section>

      <section style={{ ...panel, overflow: "hidden" }}>
        <div className="blocks-table-wrap">
          <table className="blocks-table">
            <thead><tr><th>Block</th><th>Age</th><th>Proposer</th><th>Transactions</th><th>Commit</th><th>Consensus</th><th /></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: TX3 }}>Loading indexed blocks…</td></tr>}
              {!loading && error && <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: WARN }}>Blocks unavailable: {error}</td></tr>}
              {!loading && !error && blocks.length === 0 && <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: TX3 }}>No blocks indexed yet.</td></tr>}
              {blocks.map((b, i) => <BlockRow key={b.height} block={b} explorer={explorer} newest={i === 0} />)}
            </tbody>
          </table>
        </div>
        {!loading && !error && blocks.length > 0 && <div className="blocks-foot">Showing the latest {blocks.length} indexed blocks <span>• refreshes every 10 seconds while live</span></div>}
      </section>
    </div>
  );
}

function BlockRow({ block, explorer, newest }: { block: PipelineBlock; explorer: string | null; newest: boolean }) {
  const commit = block.votes.signed !== null && block.votes.total !== null ? `${block.votes.signed} / ${block.votes.total}` : "—";
  const complete = block.votes.signed !== null && block.votes.total !== null && block.votes.signed >= block.votes.total;
  const href = explorer ? `${explorer}/block/${block.height}` : null;
  return <tr className={newest ? "blocks-row-newest" : undefined}>
    <td><a className="block-height" href={href ?? `#/blocks`} target={href ? "_blank" : undefined} rel={href ? "noreferrer" : undefined}>#{fmt(block.height)}</a></td>
    <td><span className="block-age">{agoFrom(block.time)} ago</span><small>{new Date(block.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></td>
    <td><div className="block-proposer">{block.proposer ? <ValidatorAvatar address={block.proposer.address} avatarUrl={block.proposer.avatar_url} title={block.proposer.moniker ?? undefined} size={24} /> : <span className="block-proposer-fallback">?</span>}<span>{block.proposer?.moniker ?? (block.proposer ? short(block.proposer.address) : "Unknown proposer")}</span></div></td>
    <td><span className="block-number">{block.tx_count ?? "—"}</span><small>transactions</small></td>
    <td><span className={complete ? "commit-good" : "commit-warn"}>{commit}</span><small>signatures</small></td>
    <td>{block.round && block.round > 0 ? <StatusPill status="degraded" /> : <span className="finalized-pill"><i />Finalized</span>}</td>
    <td><span className="block-chevron">›</span></td>
  </tr>;
}
