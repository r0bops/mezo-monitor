import { useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getTransactions, type Transaction } from "../api";
import { agoFrom } from "../lib";
import { Label, panel, TX, TX2, OK, BAD, WARN, sans } from "../components/ui";

export function Transactions({ d, live }: { d: Dashboard; live: boolean }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => getTransactions(25).then((r) => {
      if (!cancelled) { setTransactions(r.transactions); setError(null); setLoading(false); }
    }).catch((e: Error) => {
      if (!cancelled) { setError(e.message); setLoading(false); }
    });
    void load();
    if (!live) return () => { cancelled = true; };
    const timer = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [live]);

  const explorer = d.net?.chain.blockscout_url?.replace(/\/$/, "") ?? "https://explorer.mezo.org";
  return (
    <div className="transactions-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section style={{ ...panel, padding: "18px 18px 16px" }}>
        <div className="page-intro-row" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <Label>Blockscout transaction index</Label>
            <h2 style={{ margin: "7px 0 4px", font: `650 18px/1.2 ${sans}`, color: TX }}>Transactions</h2>
            <p style={{ margin: 0, font: `400 12px/1.4 ${sans}`, color: TX2 }}>Recent Mezo transactions, decoded by the network explorer.</p>
          </div>
          <a className="transactions-explorer-link" href={`${explorer}/txs`} target="_blank" rel="noreferrer">Open explorer ↗</a>
        </div>
        <div className="transaction-count"><strong>{loading ? "—" : transactions.length}</strong><span>recent transactions shown</span></div>
      </section>

      <section style={{ ...panel, overflow: "hidden" }}>
        <div className="transactions-table-wrap">
          <table className="transactions-table">
            <thead><tr><th>Txn Hash</th><th>Method</th><th>From</th><th>To</th><th>Age</th><th>Status</th><th>Amount</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="transaction-empty">Loading transactions…</td></tr>}
              {!loading && error && <tr><td colSpan={7} className="transaction-empty transaction-error">Transactions unavailable: {error}</td></tr>}
              {!loading && !error && transactions.length === 0 && <tr><td colSpan={7} className="transaction-empty">No transactions returned by the explorer.</td></tr>}
              {transactions.map((tx) => <TransactionRow key={tx.hash ?? `${tx.timestamp}-${tx.block}`} tx={tx} explorer={explorer} />)}
            </tbody>
          </table>
        </div>
        {!loading && !error && transactions.length > 0 && <div className="transactions-foot">Showing the latest {transactions.length} transactions <span>• refreshes every 15 seconds while live</span></div>}
      </section>
    </div>
  );
}

function TransactionRow({ tx, explorer }: { tx: Transaction; explorer: string }) {
  const successful = tx.status === "ok" || tx.status === "success";
  const statusColor = tx.status === "error" || tx.status === "failed" ? BAD : successful ? OK : WARN;
  return <tr>
    <td><a className="transaction-hash" href={tx.hash ? `${explorer}/tx/${tx.hash}` : `${explorer}/txs`} target="_blank" rel="noreferrer">{tx.hash ? shortTx(tx.hash, 12) : "—"}</a>{tx.block !== null && <small>block {tx.block.toLocaleString()}</small>}</td>
    <td><span className="transaction-method">{tx.method ?? "transaction"}</span></td>
    <td><span className="transaction-address">{tx.from_name ?? (tx.from ? shortTx(tx.from, 10) : "—")}</span></td>
    <td><span className="transaction-address">{tx.to_name ?? (tx.to ? shortTx(tx.to, 10) : "Contract creation")}</span></td>
    <td><span className="transaction-age">{tx.timestamp ? `${agoFrom(tx.timestamp)} ago` : "—"}</span></td>
    <td><span className="transaction-status" style={{ color: statusColor, background: tx.status === "error" || tx.status === "failed" ? "var(--badSoft)" : successful ? "var(--okSoft)" : "var(--warnSoft)" }}><i />{tx.status ?? "unknown"}</span></td>
    <td><span className="transaction-amount">{formatAmount(tx.amount)}</span></td>
  </tr>;
}

function shortTx(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function formatAmount(value: string | null) {
  if (!value || value === "0") return "—";
  try { return `${(Number(BigInt(value)) / 1e18).toFixed(4)} BTC`; } catch { return "—"; }
}
