// token_info: Jupiter Tokens V2 + DexScreener + Helius (holders, pump.fun curve). Cached 30 s.
import { SOL_MINT, isPubkey, UserError, fmtUsd, fmtPct, fmtAmount, dexscreenerToken, solscanToken, pumpfunCoin } from "./util.js";
import { searchTokens } from "./jupiter.js";
import { getPairs, bestPair } from "./dexscreener.js";
import { heliusConfigured, getPumpCurve, getLargestAccounts, getTokenSupply, getMultipleAccountsParsed } from "./helius.js";
import { pumpCurvePda } from "./solana.js";
import { cached } from "./kv.js";

const num = (x) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: e?.message || String(e) }));

export function normalizeMint(input) {
  const q = String(input ?? "").trim();
  if (/^(w?sol|solana)$/i.test(q)) return SOL_MINT;
  if (!isPubkey(q)) throw new UserError(`"${q.slice(0, 60)}" is not a valid Solana contract address`);
  return q;
}

/** Pure: top-N % of supply from largest accounts, skipping excluded owners. */
export function topHoldersPct(largest, owners, supplyRaw, excludeOwners = [], n = 10) {
  const supply = BigInt(String(supplyRaw || 0));
  if (supply <= 0n) return null;
  const ex = new Set(excludeOwners);
  let sum = 0n, used = 0;
  largest.forEach((a, i) => {
    if (used >= n) return;
    if (owners[i] && ex.has(owners[i])) return;
    sum += BigInt(a.amount); used++;
  });
  return Number((sum * 1000000n) / supply) / 10000;
}

async function holdersFromChain(mint) {
  const [largest, supply] = await Promise.all([getLargestAccounts(mint), getTokenSupply(mint)]);
  if (!largest.length || !supply) return null;
  let owners = [];
  try {
    const accs = await getMultipleAccountsParsed(largest.map((a) => a.address));
    owners = accs.map((a) => a?.data?.parsed?.info?.owner || null);
  } catch {}
  let curve = null;
  try { curve = pumpCurvePda(mint); } catch {}
  const pct = topHoldersPct(largest, owners, supply.amount, curve ? [curve] : []);
  return { top10Pct: pct, excludedCurve: !!curve && owners.includes(curve), supplyUi: Number(supply.uiAmountString ?? supply.uiAmount) };
}

async function build(mint) {
  const isSol = mint === SOL_MINT;
  const helius = heliusConfigured() && !isSol;
  const [jupR, dexR, curveR, holdR] = await Promise.all([
    settle(searchTokens(mint)),
    settle(getPairs(mint)),
    helius ? settle(getPumpCurve(mint)) : Promise.resolve({ ok: true, v: null }),
    helius ? settle(holdersFromChain(mint)) : Promise.resolve({ ok: true, v: null }),
  ]);
  const t = jupR.ok ? (jupR.v || []).find((x) => x.id === mint) : null;
  const pair = dexR.ok ? bestPair(dexR.v) : null;
  const curve = curveR.ok ? curveR.v : null;
  const hold = holdR.ok ? holdR.v : null;
  const side = pair ? (pair.baseToken?.address === mint ? pair.baseToken : pair.quoteToken?.address === mint ? pair.quoteToken : null) : null;

  if (!t && !pair && !curve) {
    const why = [jupR.ok ? null : jupR.e].filter(Boolean).join("; ");
    throw new UserError(`No data found for ${mint}${why ? ` (${why})` : ""}. Check the contract address.`, 404);
  }

  const audit = t?.audit || {};
  const pick = (...vals) => { for (const v of vals) if (v !== undefined && v !== null) return v; return null; };
  const s24 = t?.stats24h || {};
  const jupVol = num(s24.buyVolume) !== null || num(s24.sellVolume) !== null ? (num(s24.buyVolume) || 0) + (num(s24.sellVolume) || 0) : null;
  const pairIsBase = pair && pair.baseToken?.address === mint;

  const links = {
    dexscreener: pair?.url || dexscreenerToken(mint),
    solscan: solscanToken(mint),
  };
  if (curve || /pump$/.test(mint) || t?.launchpad === "pump.fun") links.pumpfun = pumpfunCoin(mint);
  for (const w of pair?.info?.websites || []) { if (w?.url) { links.website = w.url; break; } }
  for (const s of pair?.info?.socials || []) { if (s?.type === "twitter" && s.url) links.x = s.url; if (s?.type === "telegram" && s.url) links.telegram = s.url; }

  return {
    mint,
    name: pick(t?.name, side?.name),
    symbol: pick(t?.symbol, side?.symbol),
    icon: pick(t?.icon, pair?.info?.imageUrl),
    decimals: pick(t?.decimals),
    priceUsd: pick(num(t?.usdPrice), pairIsBase ? num(pair?.priceUsd) : null),
    change24hPct: pick(num(s24.priceChange), pairIsBase ? num(pair?.priceChange?.h24) : null),
    mcap: pick(num(t?.mcap), num(pair?.marketCap)),
    fdv: pick(num(t?.fdv), num(pair?.fdv)),
    liquidityUsd: pick(num(t?.liquidity), num(pair?.liquidity?.usd)),
    volume24hUsd: pick(jupVol, num(pair?.volume?.h24)),
    holderCount: pick(num(t?.holderCount)),
    topHoldersPct: pick(num(audit.topHoldersPercentage), num(t?.topHoldersPercentage)),
    top10Pct: hold?.top10Pct ?? null,
    top10ExcludesCurve: !!hold?.excludedCurve,
    devBalancePct: pick(num(audit.devBalancePercentage), num(t?.devBalancePercentage)),
    mintAuthorityDisabled: pick(audit.mintAuthorityDisabled, t?.mintAuthorityDisabled),
    freezeAuthorityDisabled: pick(audit.freezeAuthorityDisabled, t?.freezeAuthorityDisabled),
    isSus: pick(audit.isSus, t?.isSus),
    isVerified: t ? !!t.isVerified : null,
    organicScore: pick(num(t?.organicScore)),
    launchpad: pick(t?.launchpad, curve ? "pump.fun" : null),
    graduatedPool: pick(t?.graduatedPool),
    graduatedAt: pick(t?.graduatedAt),
    curve: curve ? { address: curve.address, progressPct: curve.progressPct, complete: curve.complete, realSol: curve.realSol } : null,
    dex: pair ? { dexId: pair.dexId, pairAddress: pair.pairAddress, url: pair.url } : null,
    links,
    sources: [t && "jupiter", pair && "dexscreener", (curve || hold) && "helius"].filter(Boolean),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getTokenInfo(input) {
  const mint = normalizeMint(input);
  return cached(`ti:${mint}`, 30, () => build(mint));
}

const yn = (v, yes, no) => (v === true ? yes : v === false ? no : "unknown");

export function formatTokenInfo(d) {
  const L = [];
  L.push(`${d.name || "Unknown"} ($${d.symbol || "?"})`);
  L.push(`CA: ${d.mint}`);
  L.push(`Price: ${d.priceUsd !== null ? fmtUsd(d.priceUsd) : "n/a"}${d.change24hPct !== null ? ` (24h ${fmtPct(d.change24hPct)})` : ""}`);
  L.push(`Market cap: ${fmtUsd(d.mcap)} · FDV: ${fmtUsd(d.fdv)} · Liquidity: ${fmtUsd(d.liquidityUsd)}`);
  L.push(`24h volume: ${fmtUsd(d.volume24hUsd)}`);
  const h = [];
  if (d.holderCount !== null) h.push(`Holders: ${fmtAmount(d.holderCount)}`);
  if (d.top10Pct !== null) h.push(`Top 10 accounts: ${d.top10Pct.toFixed(2)}%${d.top10ExcludesCurve ? " (excl. bonding curve)" : " (may include pools)"}`);
  if (d.topHoldersPct !== null) h.push(`Top holders (Jupiter): ${d.topHoldersPct.toFixed(2)}%`);
  if (d.devBalancePct !== null) h.push(`Dev holds: ${d.devBalancePct.toFixed(2)}%`);
  if (h.length) L.push(h.join(" · "));
  if (d.curve) {
    L.push(d.curve.complete
      ? `pump.fun curve: complete (graduated${d.graduatedPool ? ` to pool ${d.graduatedPool}` : ""})`
      : `pump.fun curve: ${d.curve.progressPct.toFixed(1)}% to graduation (${fmtAmount(d.curve.realSol)} SOL in curve)`);
  } else if (d.graduatedPool) {
    L.push(`Graduated from ${d.launchpad || "launchpad"} to pool ${d.graduatedPool}`);
  }
  if (d.mintAuthorityDisabled !== null || d.freezeAuthorityDisabled !== null) {
    L.push(`Mint authority: ${yn(d.mintAuthorityDisabled, "disabled", "ENABLED")} · Freeze authority: ${yn(d.freezeAuthorityDisabled, "disabled", "ENABLED")}`);
  }
  const flags = [];
  if (d.isVerified) flags.push("Jupiter verified");
  if (d.isSus) flags.push("flagged suspicious by Jupiter");
  if (d.organicScore !== null) flags.push(`organic score ${Math.round(d.organicScore)}`);
  if (flags.length) L.push(flags.join(" · "));
  const ln = [`DexScreener: ${d.links.dexscreener}`, `Solscan: ${d.links.solscan}`];
  if (d.links.pumpfun) ln.push(`pump.fun: ${d.links.pumpfun}`);
  if (d.links.website) ln.push(`Website: ${d.links.website}`);
  if (d.links.x) ln.push(`X: ${d.links.x}`);
  L.push(ln.join("\n"));
  L.push(`Sources: ${d.sources.join(", ")} · ${d.fetchedAt}`);
  return L.join("\n");
}
