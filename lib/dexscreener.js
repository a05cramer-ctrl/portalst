// DexScreener (no key): best pair for a Solana mint, used as fallback/extra.
import { fetchJson } from "./http.js";

export async function getPairs(mint) {
  const r = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { retries: 0, timeoutMs: 8000 });
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data;
}

/** Highest-liquidity pair, or null. */
export function bestPair(pairs) {
  if (!pairs?.length) return null;
  return [...pairs].sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0];
}
