/**
 * token-radar-01 proof-test entry: a token launch radar.
 *
 * Reads a frozen DefiLlama snapshot, finds the protocols that record no token
 * and are not a wrapped, staked or bridged product of a token that trades,
 * ranks them by a stated implied value, and writes:
 *   <output>/board.json        the ranked board (100 rows)
 *   <output>/dashboard/        the static dashboard plus its data.js
 *   <output>/screenshots/      the three dashboard screenshots
 *   <output>/dossier.json      the dossier buildDossier writes from those
 *
 * Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
 * At grading the input is /input/snapshot.json and the output is /output.
 *
 * Implied-value model (see impliedValueUsd):
 *   implied = floor(0.35 * tvl_usd * growth * maturity)
 *   growth   = 1 + clamp(change_7d, -50, +100) / 200   (1.0 when change_7d is null)
 *   maturity = 0.8 + 0.4 * min(1, age_days / 365)      (1.0 when listed_at is null)
 * The 0.35 base says a launch is worth roughly a third of the protocol's TVL;
 * growth rewards a rising TVL and maturity rewards a longer track record with
 * no token. Every input comes from the snapshot itself; no protocol is named
 * by hand. The value is this entry's own claim, never make.fun's.
 *
 * Deterministic: no timestamps, no randomness, every sort has a slug
 * tie-break, and two runs write byte-identical outputs.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const BOARD_ROWS = 100;
const MAX_IMPLIED_VALUE_USD = 100_000_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Categories DefiLlama uses for wrapped, staked or bridged products.
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// Exchanges whose name at the start of a protocol name marks a custodial product.
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

// A version marker at the end of a name: " V2", " v2", " 2.0" and the like.
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
}

function parseArgs(argv: string[]): { input: string } {
  let input = '/input/snapshot.json';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) {
      input = argv[i + 1] as string;
      i++;
    }
  }
  return { input };
}

function outputDir(): string {
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env !== undefined && env !== '') return env;
  if (existsSync('/output')) return '/output';
  return 'out';
}

/** Whole days between a YYYY-MM-DD date and the snapshot's as_of date. */
function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const [ly, lm, ld] = listedAt.split('-').map(Number);
  const [ay, am, ad] = asOf.split('-').map(Number);
  const days = Math.floor((Date.UTC(ay, am - 1, ad) - Date.UTC(ly, lm - 1, ld)) / DAY_MS);
  return Math.max(0, days);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** True when the snapshot records no token for the protocol. */
function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * True when the protocol looks like a wrapped, staked or bridged product of a
 * token that already trades: an excluded category, a versioned name, a whole
 * word wrapped/staked/staking in the name, or an exchange's name up front.
 */
function isWrappedOrStakedProduct(p: Protocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix));
}

/** A protocol the radar ranks: it records no token and is no wrapped product. */
function isEligible(p: Protocol): boolean {
  return isPreToken(p) && !isWrappedOrStakedProduct(p);
}

/**
 * The implied value of a launch, in whole US dollars, from the snapshot's own
 * figures: TVL, seven-day growth and age with no token. See the header for
 * the formula. Always a positive whole number within the gate's cap.
 */
function impliedValueUsd(p: Protocol, asOf: string): number {
  const growth = p.change_7d === null ? 1 : 1 + clamp(p.change_7d, -50, 100) / 200;
  const age = ageDays(p.listed_at, asOf);
  const maturity = age === null ? 1 : 0.8 + 0.4 * Math.min(1, age / 365);
  const value = Math.floor(0.35 * p.tvl_usd * growth * maturity);
  return clamp(Math.max(1, value), 1, MAX_IMPLIED_VALUE_USD);
}

function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${value.toLocaleString('en-US')}`;
}

/** The first farm step, shaped by what the protocol does. */
function firstFarmStep(p: Protocol): string {
  const chain = p.chains[0] ?? 'its main chain';
  const category = p.category ?? '';
  if (category === 'Dexs') {
    return `Swap on ${p.name} on ${chain}: trade about $100 of volume across two pairs, then add about $100 to a liquidity pool and hold it for at least 2 weeks; budget roughly $1-$5 in gas per action.`;
  }
  if (category === 'Lending') {
    return `Supply about $100-$250 of collateral on ${p.name} (${chain}) and borrow a small amount against it; keep the position open for at least 2 weeks and check the health factor weekly, about 10 minutes each time.`;
  }
  if (category === 'Derivatives' || category === 'Perps' || category === 'Options') {
    return `Open a small position of about $50-$100 on ${p.name} (${chain}) and close it after a few days; repeat once a week for a month so the wallet shows steady use, budgeting roughly $1-$5 in fees per trade.`;
  }
  if (category === 'Yield' || category === 'Farm' || category === 'Yield Aggregator') {
    return `Deposit about $100-$250 into a ${p.name} vault on ${chain} and leave it staked for at least 2 weeks; check the yield weekly, about 10 minutes, and note the entry date and amount.`;
  }
  return `Use ${p.name} on ${chain} with about $50-$250: make one real transaction a week for 4 weeks so the wallet shows steady activity, budgeting roughly $1-$5 in gas per week.`;
}

/**
 * Three concrete farm steps for a protocol: use it, chase its points or
 * quests, then monitor the position. Each step states a cost or a time.
 */
function farmStepsFor(p: Protocol): string[] {
  const steps = [
    firstFarmStep(p),
    `Look for a points program, quest board or leaderboard in the ${p.name} app; finish the weekly tasks (about 30 minutes a week) from the same wallet you used above, and keep a note of each completed task.`,
    `Review the position once a week (about 10 minutes): check ${p.name}'s TVL, currently ${formatUsd(p.tvl_usd)}, and any token or airdrop announcement, and reduce or exit if TVL falls by more than a third; never pay anyone promising a guaranteed allocation.`,
  ];
  for (const step of steps) {
    const length = step.trim().length;
    if (length < 20 || length > 600) throw new Error(`farm step for ${p.slug} is ${length} characters, outside 20-600`);
  }
  return steps;
}

function compareRanked(a: { implied: number; slug: string }, b: { implied: number; slug: string }): number {
  if (b.implied !== a.implied) return b.implied - a.implied;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * Builds the 100-row board: every watchlist protocol plus the 60 highest
 * implied-value eligible protocols outside it, ranked by implied value with
 * a slug tie-break so the order is stable.
 */
function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p === undefined) throw new Error(`watchlist slug ${slug} is not in the snapshot`);
    if (!isEligible(p)) throw new Error(`watchlist slug ${slug} fails the eligibility filter`);
  }
  const scored = snapshot.protocols
    .filter(isEligible)
    .map((p) => ({ protocol: p, implied: impliedValueUsd(p, snapshot.as_of) }));
  const extras = scored
    .filter((s) => !watchlist.has(s.protocol.slug))
    .sort(compareRanked)
    .slice(0, BOARD_ROWS - snapshot.watchlist.length);
  if (extras.length < BOARD_ROWS - snapshot.watchlist.length) {
    throw new Error(`only ${extras.length} eligible protocols outside the watchlist, need ${BOARD_ROWS - snapshot.watchlist.length}`);
  }
  const chosen = scored.filter((s) => watchlist.has(s.protocol.slug)).concat(extras);
  chosen.sort(compareRanked);
  return chosen.map((s, index) => ({
    slug: s.protocol.slug,
    name: s.protocol.name,
    rank: index + 1,
    implied_value_usd: s.implied,
    farm_steps: farmStepsFor(s.protocol),
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    listed_at: s.protocol.listed_at,
    age_days: ageDays(s.protocol.listed_at, snapshot.as_of),
    watchlist: watchlist.has(s.protocol.slug),
  }));
}

function main(): void {
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const { input } = parseArgs(process.argv.slice(2));
  const outDir = outputDir();
  const snapshot = JSON.parse(readFileSync(input, 'utf8')) as Snapshot;
  const rows = buildBoard(snapshot);

  const board = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model:
      'implied_value_usd = floor(0.35 * tvl_usd * growth * maturity); ' +
      'growth = 1 + clamp(change_7d, -50, 100) / 200 (1.0 when change_7d is null); ' +
      'maturity = 0.8 + 0.4 * min(1, age_days / 365) (1.0 when listed_at is null). ' +
      'Ranked protocols record no token and are not wrapped, staked or bridged products.',
    rows,
  };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  cpSync(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
  writeFileSync(
    join(outDir, 'dashboard', 'data.js'),
    `window.TOKEN_RADAR_BOARD = ${JSON.stringify(board, null, 2)};\n`,
    'utf8',
  );
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

  const watchlistCovered = rows.filter((r) => r.watchlist).length;
  console.log(`board: ${rows.length} rows, watchlist covered ${watchlistCovered}/${snapshot.watchlist.length}`);
  console.log(`rank 1: ${rows[0]?.slug} at $${rows[0]?.implied_value_usd}`);
  console.log(`wrote ${outDir}/board.json, dashboard/, screenshots/, dossier.json`);
}

main();
