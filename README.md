# Mezo Monitor

> Real-time validator & network health monitor for Mezo.

**Mezo Monitor** is a real-time validator and network-health monitor for Mezo
(Cosmos SDK / CometBFT, Proof-of-Authority). It indexes block production and
validator signing — uptime, missed-block streaks, proposer share, and
validator-set changes — and exposes them via a REST API. Consensus-level
analytics only; transaction-level detail is left to Blockscout.

Phase 1: indexer + REST API. Phase 2: React dashboard, served by the API at `/`.

## Stack
- TypeScript (Node 20+, ESM), pnpm workspaces
- PostgreSQL 16 (Docker Compose)
- Drizzle ORM · Fastify · ws · zod

## Layout
| Path | Responsibility |
|------|----------------|
| `packages/core` | DB schema, migrations, shared db client |
| `packages/adapters/cometbft` | Generic CometBFT indexer (block ingest + validator-set tracking) |
| `packages/api` | Fastify REST API + dashboard host |
| `packages/web` | React dashboard (Vite) |
| `chains/*.yaml` | Per-chain config (Mezo: `chains/mezo.yaml`) |

## Quickstart
```bash
pnpm install                 # install deps
cp .env.example .env         # set MEZO_RPC_URL / MEZO_RPC_WS_URL, and API_HOST
pnpm db:up                   # start Postgres (docker, bound to 127.0.0.1)
pnpm db:migrate              # apply migrations
pnpm dev                     # run indexer + API concurrently
pnpm test                    # derivation + drain tests (throwaway test database)
```

The API binds `API_HOST` (default `127.0.0.1`) so it is never accidentally
published on a host with a public IP. Set it to your Tailscale address
(`tailscale ip -4`) to reach the dashboard over the tailnet.

## Running as a service
```bash
sudo cp deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mezo-indexer mezo-api

systemctl status mezo-indexer mezo-api
journalctl -u mezo-indexer -f
```
Both units restart on failure and survive reboot. Restarting the indexer re-runs
backfill and the gap scanner, so blocks missed while it was down are repaired.

## Endpoints
- `GET /api/v1/network` — latest height, avg block time (100-block window), signing rate, active
  validator count, and indexer lag against chain head (polled from CometBFT `/status`)
- `GET /api/v1/validators` — list (address, moniker, local label, uptime % @1k/10k, missed streak,
  proposer share)
- `GET /api/v1/validators/:address?window=N` — detail + signing slots (heatmap). `signed: null`
  means the validator was outside the set at that height
- `PATCH /api/v1/validators/:address` — `{ label: string|null }` and/or `{ watched: boolean }`:
  local, operator-assigned identity (labels are never overwritten by ingestion)
- `GET /api/v1/validator-set` — current membership + add/remove history
- `GET /api/v1/metrics?hours=24|168|720` — aggregates, bucketed series, per-hour (24h) or
  per-day (7d/30d) block volume, proposer distribution
- `GET /api/v1/series?minutes=&buckets=` — block time / signing rate / block count over a window
- `GET /api/v1/alerts` — rules + event feed · `PATCH /api/v1/alerts/rules/:id` —
  `{ enabled }` and/or `{ webhook_url }`
- `GET /api/v1/endpoints` — endpoint health · `PATCH /api/v1/endpoints/:id` — `{ pinned }`
- `GET /api/v1/config` — chain identity, capabilities, indexer settings (RPC credentials redacted)

Values that genuinely cannot be known are `null`, never `0` — an unreachable RPC leaves
`indexer_lag_blocks` null, and an unbackfilled window reports slot counts instead of a percentage.

## Dashboard
The API serves the built SPA at `/`. Build it first:

```bash
pnpm --filter @mezo/web build   # writes packages/web/dist, served by the API
pnpm --filter @mezo/web dev     # or: Vite dev server on :5173, proxying /api to :3000
```

Pages: Overview, Validators, Validator Set, Metrics, Alerts, API & Docs, Settings. Dark and light
themes. Append `?debug` to the URL for the state switcher, which forces each loading/empty/stalled
/backfill state for visual checking (it is otherwise dev-only).

## RPC endpoints and failover
Endpoints are declared per chain in `chains/*.yaml`:

```yaml
endpoints:
  - label: primary
    rpc_url: ${MEZO_RPC_URL}
    ws_url: ${MEZO_RPC_WS_URL}
    priority: 10
  - label: backup
    rpc_url: ${MEZO_RPC_URL_2}
    priority: 20
```

Omit the list and the top-level `rpc_url`/`ws_url` is used as a single endpoint, so existing
configs keep working. An endpoint whose `${VAR}` is unset is skipped with a warning rather than
registered as a dead URL.

The indexer probes every endpoint on an interval, records health, and switches to the healthiest by
priority — immediately on repeated ingest failures, not only on the next probe. A node that answers
but has fallen behind is treated as unhealthy: it looks fine while producing nothing. When nothing
is healthy the indexer holds position rather than flapping, and recovers on its own.

The dashboard header shows the active endpoint with health and latency, and lets you pin one.
A pin overrides automatic selection and survives restarts, but is itself overridden while that node
is unhealthy — staying on a dead node because it was pinned is worse than moving off it. The pin
flag is kept, so control returns once it recovers.

Switching the endpoint changes where **new** blocks are read from. Unlike polkadot.js, where the
browser holds the connection, the indexer holds it here — history already in Postgres is unaffected.

## Alerting
Rules live in `alert_rules` and are evaluated every 30s by the API against the same derived metrics
it serves — no separate ingestion path. Events are edge-triggered: opened when a condition starts
holding, resolved when it clears. The default rules (missed streak, uptime, indexer lag, block time,
validator-set change) are seeded on first start; the set-change rule ships disabled so a genesis
bootstrap doesn't emit one event per validator.

Two of the defaults exist because the RPC-dependent metrics go silent exactly when they matter:

- **Indexer stale** (`indexer_stale`) — seconds since the newest indexed block, derived from the
  database alone. Indexer *lag* needs a reachable RPC to know the chain head; when the RPC is
  unreachable, lag is null and the lag rule is skipped. Staleness still knows the truth, so a dead
  data source produces an event instead of silence. The threshold is the larger of the stored value
  and the block-time-derived stall threshold (the same heuristic as the dashboard's "stopped"
  status — they share one function).
- **No healthy endpoint** (`healthy_endpoints`) — no endpoint row with `healthy = true`, which
  distinguishes "a node died and we failed over cleanly" (no event) from "nowhere left to go".

Set a rule's `webhook_url` to receive deliveries — a plain JSON POST carrying a `text` summary plus
structured fields, which Slack, Discord and PagerDuty incoming webhooks all accept:

```bash
curl -X PATCH "$API/api/v1/alerts/rules/3" -H 'content-type: application/json' \
  -d '{"webhook_url":"https://hooks.slack.com/services/..."}'
```

Delivery runs as a pass separate from evaluation, so a dead endpoint can never stall alerting.
Each event notifies once when it fires and again when it clears, with bounded retries and the last
error recorded and shown on the Alerts page. With no webhook set, rules are dashboard-only — events
are recorded, nothing is sent.

## Validator identity
CometBFT `/validators` exposes no names, but Mezo's custom `x/poa` module does: the indexer fetches
`{lcd_url}/poa/v1/validators` (`MEZO_LCD_URL` in `.env`, `lcd_url` in `chains/*.yaml`), derives each
entry's consensus address from its ed25519 pubkey (`sha256(key)[:20]`, the same derivation CometBFT
uses), and writes the monikers onto the indexed validators. A wrong-chain LCD matches nothing, so it
cannot poison the mapping. Unset `MEZO_LCD_URL` simply leaves validators nameless.

On top of the chain-sourced monikers, each validator has a local `label` and a `watched` flag
editable from the Validators page — "is mine healthy?" needs an operator's own names, not just the
chain's.

## Signature retention
`block_signatures` grows ~20 rows per block (~480k/day). Raw rows are kept for the long uptime
window (10,000 blocks) plus a margin (12,000 total; `SIGNATURE_RETAIN_BLOCKS`), and older rows are
rolled into `validator_signing_daily` (per-validator, per-day slot/signed counts) and deleted. The
sweep (`SIGNATURE_RETENTION_SWEEP_MS`, default 6h) aggregates each height range exactly once inside
a transaction with the `signature_retention` watermark, so re-runs never double-count. It needs no
RPC and runs even while every endpoint is down.

## Adding a second CometBFT chain
The core schema is chain-agnostic and the CometBFT adapter is generic, so adding
a chain is **a new YAML file only — no code changes**:

1. Create `chains/<your-chain>.yaml` (copy `chains/mezo.yaml`):
   ```yaml
   slug: your-chain-mainnet
   name: Your Chain Mainnet
   chain_id: <cosmos-chain-id>
   family: cometbft
   rpc_url: ${YOUR_RPC_URL}
   ws_url: ${YOUR_RPC_WS_URL}
   blockscout_url: https://...
   capabilities:
     delegations: <bool>
     governance: <bool>
     slashing: <bool>
     poa: <bool>
   ```
2. Add `YOUR_RPC_URL` / `YOUR_RPC_WS_URL` to `.env`.
3. Restart the indexer — it discovers every `chains/*.yaml` and indexes each.

## Design notes
- **Idempotent** ingestion — safe to restart anytime (`ON CONFLICT DO NOTHING`).
- **Backfill** — on start, indexes backward from head to `BACKFILL_DEPTH`
  (default 50,000), concurrently with live ingestion. On a non-archive node it
  stops gracefully at the pruning boundary.
- **Mezo is PoA** — `capabilities` disables delegations, governance, slashing,
  commission. None of those are modeled.
- **No block is skipped** — live ingest advances one height at a time and never
  jumps the cursor to a newly-observed head; a failed fetch stops the drain so
  the next tick retries rather than stranding a hole. A gap scanner sweeps the
  trailing range periodically and refetches anything missing.
- **Fail fast, not silent** — the DB pool sets connect/statement/query timeouts
  so a wedged database surfaces as the dashboard's "unreachable" state instead
  of hanging requests forever.
