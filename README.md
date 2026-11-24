# Token Radar

A proof-test entry for the make.fun **token-radar-01** bounty: a token launch
radar. It reads a frozen DefiLlama snapshot, finds the protocols that record
no token and are not wrapped, staked or bridged products of a token that
trades, ranks them by a stated implied value, and hands in a web dashboard
that shows the board, a detail view for each protocol and the steps to farm it.

## Run it

Requires Node.js 22.18 or later (Node 24 works too). No dependencies to
install; the program uses the standard library only.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

At grading the input is `/input/snapshot.json` and the output directory is
`/output` (via `MAKEFUN_OUTPUT_DIR`). The run writes:

- `board.json` — the ranked board (100 rows)
- `dashboard/` — the static dashboard plus its generated `data.js`
- `screenshots/` — the three dashboard screenshots
- `dossier.json` — the dossier `buildDossier` writes from those files

Two runs write byte-identical outputs: no timestamps, no randomness, every
sort has a slug tie-break.

## What counts as pre-token

A protocol is ranked when it satisfies both rules, checked from the
snapshot's own fields only:

1. **It records no token** — both `gecko_id` and `symbol` are null.
2. **It is not a wrapped, staked or bridged product** of a token that already
   trades — its category is not Bridge, Canonical Bridge, Liquid Staking,
   Liquid Restaking, Restaked BTC or CEX; its name does not end in a version
   marker (`V2`, `v2`, `2.0` and the like); its name carries no whole word
   `wrapped`, `staked` or `staking`; and it does not begin with an exchange's
   name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini).

“No token” means the snapshot records no token — not proof the protocol has
none. The board holds all 40 watchlist protocols plus the 60 highest
implied-value eligible protocols outside it.

## Implied-value model

Each ranked protocol gets an implied launch value from the snapshot's own
figures — its TVL, its seven-day TVL change and how long it has run with no
token — computed by `impliedValueUsd` in `main.ts`:

```
implied = floor(0.35 × tvl_usd × growth × maturity)
growth   = 1 + clamp(change_7d, -50, +100) / 200   (1.0 when change_7d is null)
maturity = 0.8 + 0.4 × min(1, age_days / 365)      (1.0 when listed_at is null)
```

The 0.35 base says a launch is worth roughly a third of the protocol's TVL;
growth rewards a rising TVL (a +100% week lifts the value by half, a −50%
week cuts it by a quarter); maturity rewards a longer track record with no
token (up to +20% after a year). No protocol is named by hand, so the same
program ranks whatever the snapshot holds. The value is this entry's own
claim, never make.fun's.

## Farm plans

Every row carries three concrete steps from `farmStepsFor`: use the protocol
(the first step is shaped by its category — swapping and pooling on a DEX,
supplying and borrowing on a lender, and so on), work its points program or
quest board, then review the position weekly. Each step states what it costs
or how long it takes.

## Dashboard

`dashboard/` is a static page with no network requests: `index.html`,
`app.css` and `app.js`, plus the generated `data.js` beside the page. It
shows the ranked board, a detail view for each protocol (click a row), and
filters by text and by category, with sorting by rank, TVL or 7-day change.
Deep links via the hash: `#detail=<slug>`, `#cat=<category>`, `#q=<text>`.

The three screenshots in `screenshots/` were rendered from these dashboard
files in a headless browser at 1440×900: the board, a protocol detail view,
and a filtered view.

## Layout

```
main.ts                  the program (Node 22, standard library only)
dashboard/               the static dashboard (index.html, app.css, app.js)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
vendor/makefun-board.ts  the scorer's dossier library, byte for byte from the kit
```

## License

MIT — see `LICENSE`.
