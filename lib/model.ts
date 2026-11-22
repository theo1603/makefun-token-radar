// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every genuine pre-token candidate: a protocol whose DefiLlama record carries no
// token (no market cap, no CoinGecko id, no symbol) and which is not a wrapped, staked or bridged
// product of a token that already trades (the house watchlist's rule, without its $50M floor).
// The watchlist's 40 are all in; the rest are the early ones the radar exists to find.
//
// Implied value is calibrated from the snapshot itself, never from a hardcoded multiple:
//
//   multiple   = the category's median mcap/TVL across the snapshot's live-token protocols,
//                each ratio winsorized to [0.005, 5] so one tiny-TVL outlier cannot set a
//                category, shrunk toward the global median (prior weight 5) and clamped to [0.02, 2.0]
//   base       = tvl_usd x multiple
//   growthMult = 1 + 0.5 x clamp(change_7d, -50, 100) / 100
//   maturity   = 0.65 + 0.35 x min(age_days, 1095) / 1095        (age unknown: 365)
//   breadth    = 1 + 0.02 x min(chains - 1, 5)
//   implied    = max(1, round(base x growthMult x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and the multiples
// come from the market the snapshot records, so the board re-derives itself on any new snapshot.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The base multiple is NOT one of them: it is
 *  calibrated from the snapshot at run time (see calibrate). */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_chains: number;
  shrink_prior: number;
  multiple_min: number;
  multiple_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.02,
  breadth_max_chains: 5,
  shrink_prior: 5,
  multiple_min: 0.02,
  multiple_max: 2.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2-calibrated';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: the median mcap/TVL of its live protocols, shrunk to the global. */
export interface CategoryCalibration {
  category: string;
  n: number;
  median: number;
  multiple: number;
}

/** The snapshot's own calibration: the market's mcap/TVL, global and per category. */
export interface Calibration {
  global_multiple: number;
  global_median: number;
  live_count: number;
  categories: CategoryCalibration[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    multiple_category: string | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so the page and board.json agree. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  multiple_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers; 0 when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name carrying a whole word wrapped, staked or staking is a product, not a launch candidate. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchanges' own products are not independent launches. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is a genuine launch candidate: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades. This is the house watchlist's rule without its $50M floor
 * (parentProtocol is not one of the snapshot's fields, so a child of a token-bearing parent can
 * still slip through; the dashboard says so).
 */
export function isGenuineCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/**
 * Calibrate the base multiple from the snapshot's own live-token protocols: the median mcap/TVL,
 * global and per category. A category's multiple is its median shrunk toward the global median
 * (prior weight 5), so a category with few live comparables leans on the market as a whole.
 * Each live ratio is winsorized to [0.005, 5] first: a token whose TVL is tiny next to a
 * speculative market cap (one live prediction market reads 400x) must not set its whole category.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX');
  const ratioOf = (p: SnapshotProtocol): number => Math.min(5, Math.max(0.005, p.mcap_usd! / p.tvl_usd));
  const globalMedian = median(live.map(ratioOf));
  const clamp = (x: number): number => Math.min(model.multiple_max, Math.max(model.multiple_min, x));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(ratioOf(p));
    byCategory.set(p.category, list);
  }
  const categories: CategoryCalibration[] = [...byCategory.entries()]
    .map(([category, ratios]) => {
      const med = median(ratios);
      const multiple = clamp((ratios.length * med + model.shrink_prior * globalMedian) / (ratios.length + model.shrink_prior));
      return { category, n: ratios.length, median: round4(med), multiple: round4(multiple) };
    })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return { global_multiple: round4(clamp(globalMedian)), global_median: round4(globalMedian), live_count: live.length, categories };
}

/** The multiple a protocol's category calibrates to, or the global one when it has no category. */
export function multipleFor(p: SnapshotProtocol, calibration: Calibration): { multiple: number; n: number } {
  if (p.category === null) return { multiple: calibration.global_multiple, n: calibration.live_count };
  const found = calibration.categories.find((c) => c.category === p.category);
  if (found === undefined) return { multiple: calibration.global_multiple, n: calibration.live_count };
  return { multiple: found.multiple, n: found.n };
}

/** The multipliers and the implied value one protocol gets under the calibrated model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; multipleN: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, n } = multipleFor(protocol, calibration);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_step * extraChains;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, multiple, multipleN: n, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly falling values. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, whatever the candidate rule says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every genuine pre-token candidate below the floor, and every genuine one
  // above it the watchlist left out. Never a replacement for a watchlist row.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isGenuineCandidate(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Ranks must fall strictly: two rows may not share an implied value, so a tie steps down a dollar.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) scored[i]!.implied = Math.max(1, scored[i - 1]!.implied - 1);
  }
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      multiple_n: s.multipleN,
      multiple_category: s.p.category,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 730) return 60;
  return 45;
}

/** Cheap layer-2s and sidechains, where a transaction costs cents. */
const CHEAP_L2 = new Set([
  'Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Starknet', 'Fraxtal', 'opBNB', 'Zora', 'Manta', 'Taiko', 'Kroma', 'Metis', 'Boba', 'Loopring', 'ImmutableX', 'ApeChain', 'Abstract', 'Unichain', 'Ink', 'Soneium', 'Sonic', 'Berachain',
]);
/** Cheap layer-1s, where a transaction costs well under a dollar. */
const CHEAP_L1 = new Set([
  'Binance', 'Avalanche', 'Tron', 'Fantom', 'Celo', 'Gnosis', 'Moonbeam', 'Kava', 'Cronos', 'Evmos', 'Harmony', 'IoTeX', 'Wax', 'Near', 'Sui', 'Aptos', 'Sei', 'Injective', 'Osmosis', 'CosmosHub', 'Kujira', 'Stargaze', 'Maya', 'Flare', 'Core', 'Rootstock', 'Bittensor', 'Hedera', 'Algorand', 'Tezos', 'Cardano', 'Polkadot', 'Kusama', 'Elrond', 'MultiversX', 'Zilliqa', 'Neo', 'Ontology', 'VeChain', 'Theta', 'Klaytn', 'Astar', 'Shiden', 'Moonriver', 'Aurora', 'Fuse', 'EVMOS', 'XRP', 'Stellar',
]);

/** What one transaction costs on a chain, as the farm plan states it. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $3-8 of gas per transaction';
  if (chain === 'Solana') return 'about $0.01 of gas per transaction';
  if (chain === 'Bitcoin') return 'about $1-5 of network fees per transaction';
  if (chain === 'Hyperliquid L1') return 'about $0.01 of gas per transaction';
  if (CHEAP_L2.has(chain)) return 'about $0.05-0.50 of gas per transaction';
  if (CHEAP_L1.has(chain)) return 'about $0.10-1 of gas per transaction';
  return 'about $0.50-2 of gas per transaction';
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): { action: string; risk: string | null } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow about 40% of it in a stablecoin and re-supply the loan so both sides of the position count.`,
      risk: `Keep the borrow under half the collateral: a sharp price move can liquidate the loan and end the farm.`,
    };
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return {
      action: `Provide $${capital} of liquidity to ${name}'s deepest stablecoin pool on ${chain} and stake the LP receipt in its rewards contract when one exists.`,
      risk: `A volatile pair can lose value to impermanent loss; a stablecoin pair keeps the position close to $${capital}.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('synthetic') || c.includes('options')) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name}, open one small hedged position at no more than 2x leverage, and close it after a week.`,
      risk: `Leverage cuts both ways: never farm with leverage above 2x, and set a stop so one move cannot wipe the margin.`,
    };
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return {
      action: `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave the receipt token in the farm wallet.`,
      risk: null,
    };
  }
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('allocator')) {
    return {
      action: `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the vault shares in the farm wallet.`,
      risk: null,
    };
  }
  if (c.includes('rwa')) {
    return {
      action: `Mint or buy $${capital} of ${name}'s yield-bearing token on ${chain} and hold it in the farm wallet.`,
      risk: null,
    };
  }
  if (c.includes('basis')) {
    return {
      action: `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the receipt token in the farm wallet.`,
      risk: `Basis yields turn negative when funding flips; check the vault's rate weekly and exit if it stays below zero.`,
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      action: `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds once in the protocol's own app.`,
      risk: null,
    };
  }
  if (c.includes('staking') || c.includes('restak') || c.includes('liquid')) {
    return {
      action: `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the farm wallet.`,
      risk: `Staked positions can take days to unstake; check the unlock window before you stake.`,
    };
  }
  if (c.includes('chain')) {
    return {
      action: `Bridge $${capital} of USDC to ${name}'s chain, swap half on its native DEX, and hold the rest in a lending market there.`,
      risk: null,
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund $${capital} on ${name} and place one small position on a market you follow, keeping most of the balance unspent.`,
      risk: `Prediction markets can lose the whole stake; never farm a market with money you need back.`,
    };
  }
  if (c.includes('stable')) {
    return {
      action: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farm wallet.`,
      risk: null,
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy to expiry.`,
      risk: null,
    };
  }
  if (c.includes('index')) {
    return {
      action: `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the farm wallet.`,
      risk: null,
    };
  }
  if (c.includes('privacy')) {
    return {
      action: `Deposit $${capital} into ${name}'s shielded pool on ${chain} and make one private transfer a week.`,
      risk: null,
    };
  }
  if (c.includes('nft lending') || c.includes('nft')) {
    return {
      action: `Supply $${capital} of USDC to ${name}'s lending pool on ${chain} and keep the position open.`,
      risk: null,
    };
  }
  if (c.includes('gaming') || c.includes('social') || c.includes('launchpad')) {
    return {
      action: `Deposit $${capital} into ${name} on ${chain}, use the app once a week, and complete any quest it lists.`,
      risk: null,
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name}'s main vault or pool on ${chain} and keep the position open.`,
    risk: null,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, plus a risk step where
 * the category carries one. The plan is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const { action, risk } = actionFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'free to create, plus a first gas top-up',
      time: '10 minutes',
    },
    {
      text: `Move $${capital} of USDC and a little of ${chain}'s gas token into the farm wallet, from an exchange or a bridge you already trust.`,
      cost: `$${capital} of capital plus ${gas} and any bridge fee`,
      time: '20 minutes',
    },
    { text: action, cost: `$${capital} in the position plus ${gas}`, time: '15-30 minutes to set up' },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active.`,
      cost: gas + ' a week',
      time: '10 minutes a week',
    },
    {
      text: `Check the protocol's own points or rewards page each week and finish any quest it lists, using only the link the protocol publishes.`,
      cost: 'free to check, and never pay to claim',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When a token or a claim goes live, claim only from the protocol's own published link, then unwind the position in two steps and log every transaction.`,
      cost: gas + ' to exit',
      time: '20 minutes',
    },
  ];
  if (risk !== null) {
    steps.splice(3, 0, { text: risk, cost: 'nothing to follow, and it protects the position', time: '2 minutes to read' });
  }
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_n: row.model.multiple_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over the gate's cap`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
