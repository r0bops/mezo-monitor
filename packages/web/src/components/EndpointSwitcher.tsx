/**
 * Endpoint switcher — the polkadot.js affordance adapted to this architecture.
 *
 * The important difference is stated in the panel itself: in polkadot.js the
 * browser holds the connection, so switching changes what you see. Here the
 * indexer holds it, so switching changes where *new* blocks come from and
 * leaves the indexed history untouched. Without saying so, the natural reading
 * is the polkadot.js one, and it's wrong.
 */
import { useEffect, useRef, useState } from "react";
import { setEndpointPinned, type Endpoint } from "../api";
import type { Dashboard } from "../useDashboard";
import { BAD, OK, TX, TX2, TX3, WARN, mono, sans } from "./ui";
import { fmt } from "../lib";

export function EndpointSwitcher({ d }: { d: Dashboard }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const endpoints = d.endpoints?.endpoints ?? [];
  const active = endpoints.find((e) => e.is_active) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = async (e: Endpoint) => {
    if (!d.endpoints) return;
    setBusy(e.id);
    try {
      const saved = await setEndpointPinned(e.id, !e.pinned);
      // Pinning makes one endpoint active and clears every other pin, so
      // reconcile the whole list rather than just the row that was clicked.
      d.setEndpoints({
        count: d.endpoints.count,
        endpoints: endpoints.map((x) =>
          x.id === saved.id
            ? saved
            : { ...x, pinned: false, is_active: saved.pinned ? false : x.is_active },
        ),
      });
    } catch {
      /* the next poll re-syncs */
    } finally {
      setBusy(null);
    }
  };

  if (endpoints.length === 0) return null;

  const dot = active ? (active.healthy ? OK : BAD) : TX3;

  return (
    <div ref={ref} style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="RPC endpoint"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 32,
          padding: "0 11px",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          color: TX,
          font: `600 11.5px/1 ${sans}`,
          cursor: "pointer",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flex: "none" }} />
        {active?.label ?? "no endpoint"}
        {active?.pinned && (
          <span style={{ font: `600 9px/1 ${sans}`, color: "var(--brand)" }}>PINNED</span>
        )}
        <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
          {active?.latency_ms !== null && active?.latency_ms !== undefined
            ? `${active.latency_ms}ms`
            : "—"}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 38,
            zIndex: 50,
            width: 340,
            borderRadius: 10,
            border: "1px solid var(--line2)",
            background: "var(--panel)",
            boxShadow: "var(--shadow)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ font: `600 11px/1 ${sans}`, color: TX }}>RPC endpoint</div>
            <div style={{ font: `400 10px/1.45 ${sans}`, color: TX3, marginTop: 4 }}>
              Feeds the indexer. Switching changes where new blocks are read from — it does not
              change history already indexed.
            </div>
          </div>

          {endpoints.map((e) => (
            <div
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderBottom: "1px solid var(--line)",
                background: e.is_active ? "var(--brandSoft)" : "transparent",
                opacity: busy === e.id ? 0.5 : 1,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flex: "none",
                  background: e.healthy ? OK : e.consecutive_failures > 0 ? BAD : WARN,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ font: `600 11.5px/1 ${sans}`, color: TX }}>{e.label}</span>
                  {e.is_active && (
                    <span style={{ font: `600 9px/1 ${sans}`, color: "var(--brand)" }}>ACTIVE</span>
                  )}
                </div>
                <span
                  style={{
                    font: `400 10px/1 ${mono}`,
                    color: TX3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={e.rpc_url ?? ""}
                >
                  {e.rpc_url ?? "—"}
                </span>
                <span style={{ font: `400 10px/1 ${mono}`, color: e.last_error ? BAD : TX2 }}>
                  {e.last_error
                    ? e.last_error
                    : `height ${fmt(e.last_height)} · ${e.latency_ms ?? "—"}ms`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void toggle(e)}
                disabled={busy !== null}
                style={{
                  flex: "none",
                  padding: "4px 8px",
                  borderRadius: 6,
                  cursor: busy !== null ? "default" : "pointer",
                  font: `600 10px/1 ${sans}`,
                  border: `1px solid ${e.pinned ? "var(--brand)" : "var(--line)"}`,
                  background: e.pinned ? "var(--brandSoft)" : "transparent",
                  color: e.pinned ? "var(--brand)" : TX2,
                }}
              >
                {e.pinned ? "Unpin" : "Pin"}
              </button>
            </div>
          ))}

          <div style={{ padding: "9px 12px", font: `400 10px/1.4 ${sans}`, color: TX3 }}>
            Unpinned, the indexer picks the healthiest node by priority and fails over
            automatically.
          </div>
        </div>
      )}
    </div>
  );
}
