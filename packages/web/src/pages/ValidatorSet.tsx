/** Validator Set: current membership plus the churn history. */
import type { Dashboard } from "../useDashboard";
import { BAD, Label, OK, StatusPill, TX, TX2, TX3, ValidatorAvatar, mono, panel, sans } from "../components/ui";
import { agoFrom, fmt, short } from "../lib";

const COLS = "32px 190px 96px 116px 116px 84px";

export function ValidatorSet({ d }: { d: Dashboard }) {
  const set = d.set;
  const members = set?.members ?? [];
  const changes = set?.changes ?? [];
  const last = changes[0];

  const stats = [
    { label: "Set size", value: fmt(set?.set_size ?? null), sub: "fixed by authority" },
    {
      label: "Total voting power",
      value: fmt(set?.total_voting_power ?? null),
      sub: equalWeight(members.map((m) => m.voting_power)),
    },
    {
      label: "Last change",
      value: last ? `${agoFrom(last.time)} ago` : "—",
      sub: last ? `height ${fmt(last.height)}` : d.bootstrap ? "genesis membership" : "no churn recorded",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="g3">
        {stats.map((s) => (
          <div key={s.label} style={{ ...panel, padding: "15px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <Label>{s.label}</Label>
            <span style={{ font: `600 24px/1 ${mono}`, color: TX }}>{s.value}</span>
            <span style={{ font: `400 11px/1.3 ${sans}`, color: TX2 }}>{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section style={{ ...panel, flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px 12px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>Current membership</h2>
            <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
              {d.net?.chain.capabilities.poa ? "equal voting power · PoA" : "voting power weighted"}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              alignItems: "center",
              padding: "0 16px",
              height: 34,
              borderBottom: "1px solid var(--line)",
              background: "var(--panel2)",
            }}
          >
            <Label size={9}>#</Label>
            <Label size={9}>Address</Label>
            <span style={{ textAlign: "right", paddingRight: 16 }}>
              <Label size={9}>Power</Label>
            </span>
            <Label size={9}>First seen</Label>
            <Label size={9}>Last seen</Label>
            <span style={{ textAlign: "right" }}>
              <Label size={9}>Status</Label>
            </span>
          </div>
          {members.length === 0 && (
            <div style={{ padding: "48px 16px", textAlign: "center", font: `400 12px/1.5 ${sans}`, color: TX3 }}>
              No validators indexed yet.
            </div>
          )}
          {members.map((m) => (
            <div
              key={m.address}
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                alignItems: "center",
                padding: "0 16px",
                height: 42,
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ font: `500 11px/1 ${mono}`, color: TX3 }}>{m.rank}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <ValidatorAvatar
                  address={m.address}
                  avatarUrl={m.avatar_url}
                  title={m.moniker ? `${m.moniker} logo` : undefined}
                  size={18}
                />
                <span style={{ font: `500 12px/1 ${mono}`, color: TX2, whiteSpace: "nowrap" }}>
                  {short(m.address)}
                </span>
                {(m.moniker || m.label) && (
                  <span
                    title={m.moniker ? `moniker: ${m.moniker}` : "local label"}
                    style={{
                      font: `400 10px/1 ${sans}`,
                      color: TX2,
                      padding: "3px 7px",
                      borderRadius: 5,
                      background: "var(--panel2)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.watched ? "★ " : ""}
                    {m.moniker ?? m.label}
                  </span>
                )}
              </div>
              <span style={{ font: `500 11.5px/1 ${mono}`, color: TX2, textAlign: "right", paddingRight: 16 }}>
                {fmt(m.voting_power)}
              </span>
              <span style={{ font: `400 11px/1 ${mono}`, color: TX3 }}>{fmt(m.first_seen_height)}</span>
              <span style={{ font: `400 11px/1 ${mono}`, color: TX3 }}>{fmt(m.last_seen_height)}</span>
              <span style={{ justifySelf: "end" }}>
                <StatusPill status={m.status} />
              </span>
            </div>
          ))}
        </section>

        <section style={{ ...panel, width: 420, flex: "none", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--line)" }}>
            <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>Change history</h2>
          </div>
          {d.bootstrap && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--panel2)" }}>
              <span style={{ font: `400 11px/1.45 ${sans}`, color: TX2 }}>
                Genesis membership only. Every row below is the initial bootstrap set; no churn has
                been recorded since.
              </span>
            </div>
          )}
          {changes.length === 0 && (
            <div style={{ padding: "40px 16px", textAlign: "center", font: `400 12px/1.5 ${sans}`, color: TX3 }}>
              No validator-set changes recorded.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {changes.map((h, i) => {
              const added = h.type === "added";
              return (
                <div
                  key={`${h.height}-${h.address}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      flex: "none",
                      font: `600 13px/1 ${mono}`,
                      background: added ? "var(--okSoft)" : "var(--badSoft)",
                      color: added ? OK : BAD,
                    }}
                  >
                    {added ? "+" : "−"}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ font: `600 11.5px/1 ${sans}`, color: added ? OK : BAD }}>
                        {added ? "Added" : "Removed"}
                      </span>
                      <span style={{ font: `500 11.5px/1 ${mono}`, color: TX2 }}>{short(h.address)}</span>
                    </div>
                    <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
                      height {fmt(h.height)} · power {fmt(h.power_before)} → {fmt(h.power_after)}
                    </span>
                  </div>
                  <span style={{ font: `400 10.5px/1 ${sans}`, color: TX3, flex: "none" }}>
                    {agoFrom(h.time)} ago
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function equalWeight(powers: (number | null)[]): string {
  const vals = powers.filter((p): p is number => p !== null);
  if (vals.length === 0) return "—";
  const first = vals[0];
  return vals.every((p) => p === first) ? `${fmt(first)} each · equal weight` : "weighted";
}
