# UI reference evaluation — four explorers, 2026-09-12

End-to-end pass with a real browser (headless Chromium, 1440×900 + scrolled + mobile 390×844;
monadvision needed a headed run under xvfb to clear its Cloudflare challenge). Screenshots of
each site sit next to this file (`*-desktop.png`, `*-scrolled.png`). Written as the standing
reference for future mezo-monitor UI work — when a change is planned, check here first for
what these four do about the same problem.

Evaluated against what we already have (sticky tiles, scrolling validator table with monikers
+ logos + flags, world map with hover cards, signing-history dropdowns, RPC console), so the
notes focus on what is *new* to us, not on restating our own features.

## monatlas.io — Monad consensus & validator analytics

The closest in spirit to this monitor (and the family of the original inspiration screenshots).
Light theme, left metrics rail, world map, and one standout we do not have:

- **Consensus pipeline** — a horizontal strip of cards following the latest block through
  `PROPOSED → VOTED → FINALIZED`, each card naming the validator (logo), block height, tx
  count; colour per stage, timeouts in red. Makes consensus legible as a *process*.
  → **Adopt.** Mezo data exists for this: proposer from the block header, precommit count
  from `/commit`, round from `/block_results`. A "latest block journey" strip with real
  validator names would be the most distinctive panel we could add.
- **Round timeouts panel** — recent slow/failed rounds with validator + age.
  → **Adopt** (same data source; complements our degraded detection).
- World map with status-coloured dots, legend, city counts — we already built this, theirs
  confirms the pattern.
- Metrics rail with icons per metric — ours are the sticky tiles; their per-metric icons are
  a cheap polish if ever wanted.

## celestia.explorers.guru/validators — classic validator list

White, data-dense, table-first. The lesson is in the columns:

- **Cumulative voting-power share bar** — each row shows the running total of concentration
  as a growing bar. Instantly answers "how top-heavy is this set".
  → **Adopt** — we already have per-validator voting power; a cumulative bar in the
  Validators table is a small, honest concentration view (PoA: all power = 1, so on Mezo the
  equivalent is cumulative *signing reliability* or proposer share instead).
- **Summary chips above the table** (active N/M, min stake, APR) — a one-glance row before
  the list. → Cheap adopt for us: `21/21 active · signing rate · longest miss streak`.
- Search by moniker/valoper + Active/Inactive tabs — we have search + status filter already.
- Stake button per row — **do not adopt** (no staking on Mezo; read-only posture).

## namada.valopers.com — dark validator analytics

Dark two-pane layout, closest to our theme:

- **Progress-bar KPI cards**: epoch progress, active validators %, **online voting power %**.
  The last one is the idea worth stealing: an aggregate "what fraction of the set's power is
  actually signing right now" — an honest, single-number health metric stronger than
  validator counts.
  → **Adopt** — we have the data (signatures + voting power); it belongs in a tile.
- Prominent network-state warning banner (theirs: archived network) — our state banner is
  the same pattern; theirs is more visually assertive.
- Latest blocks table with proposer + success checkmark — we show equivalents.
- Not trading / market cards with explicit dashes — aligns with our null-honesty rule; good
  confirmation, nothing to build.

## monadvision.com — clean EVM explorer

The "calm" pole: light theme, hero search, curated 2×2 metric cards, leaderboard, View More
links, feedback button, theme toggle.

- **Search-first entry** — for a monitor (not a lookup tool) this is low priority, but a
  global "jump to validator / block height" search is a nice eventual affordance.
- **Feedback button** (floating, bottom-right) → cheap adopt even as a mailto/tailnet form;
  community-friendly for the public site.
- Generous whitespace and one accent colour — aesthetic confirmation of the decluttered
  chrome direction already taken; no structural change needed.
- Placeholder/skeleton metric cards while loading — we have skeletons; same pattern.

## What NOT to adopt (checked and rejected)

- Stake/delegate CTAs, delegator & commission columns — no staking on Mezo; monitor stays
  read-only.
- Price / market-cap / APR economics cards — not our data, not our job; dashes would be the
  honest render and that is not worth the space.
- Epoch metrics — Mezo has no epochs.

## Priority shortlist when next touching the UI

1. Consensus pipeline strip (monatlas) — highest distinctiveness, data available.
2. Online-signing-power % tile (namada) — honest aggregate health number.
3. Cumulative-share bar in the Validators table (guru) — concentration at a glance.
4. Summary chip row above the validators table (guru).
5. Round-timeout surfacing (monatlas) — from `/block_results` round data.
6. Feedback button (monadvision) — trivial, public-friendly.
