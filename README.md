# Mezo Monitor

> Real-time validator & network health monitor for Mezo.

**Mezo Monitor** is a real-time validator and network-health monitor for Mezo
(Cosmos SDK / CometBFT, Proof-of-Authority). It indexes block production and
validator signing — uptime, missed-block streaks, proposer share, and
validator-set changes — and exposes them via a REST API. Consensus-level
analytics only; transaction-level detail is left to Blockscout.

Phase 1: indexer + REST API. No frontend.

## Stack
- TypeScript (Node 20+, ESM), pnpm workspaces
- PostgreSQL 16 (Docker Compose)
- Drizzle ORM · Fastify · ws · zod

## Layout
| Path | Responsibility |
|------|----------------|
| `packages/core` | DB schema, migrations, shared db client |
| `packages/adapters/cometbft` | Generic CometBFT indexer (block ingest + validator-set tracking) |
| `packages/api` | Fastify REST API |
| `chains/*.yaml` | Per-chain config (Mezo: `chains/mezo.yaml`) |

## Quickstart
```bash
pnpm install                 # install deps
cp .env.example .env         # then edit .env: set MEZO_RPC_URL / MEZO_RPC_WS_URL
pnpm db:up                   # start Postgres (docker)
pnpm db:migrate              # apply migrations
pnpm dev                     # run indexer + API concurrently
```
API: http://localhost:3000

## Endpoints
- `GET /api/v1/validators` — list (moniker, address, uptime % @1k/10k, missed streak, proposer share)
- `GET /api/v1/validators/:address` — detail + last 500 signing slots (heatmap)
- `GET /api/v1/network` — latest height, avg block time (100-block window), active validator count, indexer lag

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
