# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/theo1603/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/theo1603/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama protocol snapshot, finds
every genuine pre-token candidate (no token recorded, not a wrapped, staked or
bridged product of one that trades), and ranks it by an implied launch value
calibrated from the snapshot itself — each category's median market-cap/TVL
across the live-token protocols, shrunk toward the global median — times
growth, maturity and chain-breadth factors. Every row carries a farm plan
derived from the protocol's own category, chains, TVL and age, with a cost
and a time per step. The dashboard is a static page (no network, no
framework): a sortable, filterable board, a detail view with the model's
breakdown, the live-token calibration set, and the model's explanation.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` reads the snapshot, writes `board.json` and `data.js`, copies
`dashboard/` and `screenshots/` to the output directory, and writes
`dossier.json` with the vendored make.fun library. Node 22.18 or later, no
dependencies, deterministic: the same snapshot always writes the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
