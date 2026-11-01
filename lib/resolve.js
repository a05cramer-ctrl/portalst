// Resolve "SOL" / a mint / a symbol into token metadata. Ambiguous symbols return candidates.
import { SOL_META, SOL_MINT, isPubkey, UserError } from "./util.js";
import { searchTokens } from "./jupiter.js";
import { getPairs, bestPair } from "./dexscreener.js";
import { getTokenSupply, heliusConfigured } from "./helius.js";

const SOL_ALIASES = new Set(["sol", "wsol", "solana", SOL_MINT.toLowerCase()]);

export function metaFromJup(t) {
  return { mint: t.id, symbol: t.symbol || "?", name: t.name || t.symbol || "", decimals: t.decimals, icon: t.icon || null };
}

/**
 * Pure: choose a token for a symbol query from a Jupiter search list.
 * → { token } when unambiguous, else { candidates } (may be empty).
 * Rule: exact (case-insensitive) symbol matches; one match → it; several → the single verified one; else ask.
 */
export function pickBySymbol(list, symbol) {
  const q = String(symbol).trim().replace(/^\$/, "").toLowerCase();
  const exact = (list || []).filter((t) => (t.symbol || "").toLowerCase() === q);
  if (exact.length === 1) return { token: exact[0] };
  const verified = exact.filter((t) => t.isVerified);
  if (verified.length === 1) return { token: verified[0] };
  const pool = (exact.length ? exact : list || [])
    .slice()
    .sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0))
    .slice(0, 5);
  return { candidates: pool };
}

export function candidatesText(query, candidates) {
  if (!candidates.length) return `No token found for "${query}". Paste the contract address (mint) instead.`;
  const lines = candidates.map((t) =>
    `- ${t.symbol} (${t.name || "?"}) — ${t.id}${t.isVerified ? " · verified" : ""}${t.liquidity ? ` · liq $${Math.round(t.liquidity).toLocaleString("en-US")}` : ""}`);
  return `"${query}" matches several tokens. Which one? Reply with the contract address:\n${lines.join("\n")}`;
}

/** Resolve one side of a swap. Throws UserError with a readable message on ambiguity/miss. */
export async function resolveToken(input) {
  const q = String(input ?? "").trim();
  if (!q) throw new UserError("Token is required (\"SOL\", a symbol, or a contract address)");
  if (SOL_ALIASES.has(q.toLowerCase())) return { ...SOL_META };
  if (isPubkey(q)) {
    let list = [];
    try { list = await searchTokens(q); } catch {}
    const hit = list.find((t) => t.id === q);
    if (hit && Number.isInteger(hit.decimals)) return metaFromJup(hit);
    // Not indexed yet (fresh launch): decimals from chain, symbol from DexScreener.
    let decimals = null, symbol = null, name = null, icon = null;
    if (heliusConfigured()) {
      try { decimals = (await getTokenSupply(q))?.decimals ?? null; } catch {}
    }
    try {
      const p = bestPair(await getPairs(q));
      const side = p?.baseToken?.address === q ? p.baseToken : p?.quoteToken?.address === q ? p.quoteToken : null;
      if (side) { symbol = side.symbol; name = side.name; }
      icon = p?.info?.imageUrl || null;
    } catch {}
    if (!Number.isInteger(decimals)) throw new UserError(`Could not find token ${q} (not indexed by Jupiter and no on-chain mint found)`, 404);
    return { mint: q, symbol: symbol || q.slice(0, 4), name: name || "", decimals, icon };
  }
  const list = await searchTokens(q.replace(/^\$/, ""));
  const pick = pickBySymbol(list, q);
  if (pick.token) return metaFromJup(pick.token);
  throw new UserError(candidatesText(q, pick.candidates), 409, { candidates: pick.candidates.map((t) => ({ mint: t.id, symbol: t.symbol, name: t.name, verified: !!t.isVerified, liquidity: t.liquidity ?? null })) });
}
