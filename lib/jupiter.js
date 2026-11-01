// Jupiter: Tokens V2, Price V3, Swap V2 (/order, /execute). JUPITER_API_KEY is optional.
import { fetchJson } from "./http.js";

const BASE = "https://api.jup.ag";

function headers() {
  const k = process.env.JUPITER_API_KEY;
  return k ? { "x-api-key": k } : {};
}

function errText(r, what) {
  const d = r.data || {};
  const m = d.error || d.errorMessage || d.message || d.raw || `HTTP ${r.status}`;
  if (r.status === 429) return `${what}: Jupiter rate limit hit, try again in a few seconds`;
  return `${what}: ${typeof m === "string" ? m : JSON.stringify(m)}`;
}

/** Tokens V2 search. query = mint, symbol, name, or comma-separated mints (≤100). */
export async function searchTokens(query) {
  const r = await fetchJson(`${BASE}/tokens/v2/search?query=${encodeURIComponent(query)}`, { headers: headers() });
  if (!r.ok) throw new Error(errText(r, "Token search failed"));
  return Array.isArray(r.data) ? r.data : [];
}

/** Price V3 for ≤50 mints per call (chunks automatically). → { mint: {usdPrice, priceChange24h, decimals, liquidity} } */
export async function getPrices(mints) {
  const out = {};
  const uniq = [...new Set(mints)];
  for (let i = 0; i < uniq.length; i += 50) {
    const ids = uniq.slice(i, i + 50).join(",");
    const r = await fetchJson(`${BASE}/price/v3?ids=${ids}`, { headers: headers() });
    if (!r.ok) throw new Error(errText(r, "Price lookup failed"));
    Object.assign(out, r.data || {});
  }
  return out;
}

/** Swap V2 order. amount is RAW units. Without taker → quote only (transaction null). */
export async function getOrder({ inputMint, outputMint, amount, taker, slippageBps }) {
  const p = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
  if (taker) p.set("taker", taker);
  if (slippageBps !== undefined && slippageBps !== null) p.set("slippageBps", String(slippageBps));
  const r = await fetchJson(`${BASE}/swap/v2/order?${p}`, { headers: headers(), timeoutMs: 15000 });
  if (!r.ok) throw new Error(errText(r, "Jupiter quote failed"));
  const d = r.data || {};
  if (d.error && !d.outAmount) throw new Error(`Jupiter quote failed: ${d.error}`);
  return d;
}

/** Swap V2 execute. Returns Jupiter's body plus a readable `message` when it failed. */
export async function executeOrder({ signedTransaction, requestId, lastValidBlockHeight }) {
  const body = { signedTransaction, requestId };
  if (lastValidBlockHeight !== undefined && lastValidBlockHeight !== null) body.lastValidBlockHeight = lastValidBlockHeight;
  const r = await fetchJson(`${BASE}/swap/v2/execute`, { method: "POST", headers: headers(), body, timeoutMs: 25000, retries: 0 });
  const d = r.data || {};
  if (!r.ok && d.status !== "Failed" && d.status !== "Success") {
    return { status: "Failed", code: d.code ?? null, error: errText(r, "Execute failed"), signature: d.signature ?? null };
  }
  return d;
}

/** Jupiter execute / program error codes → readable text. */
export const EXEC_ERRORS = {
  "0": "Success",
  "-1": "Order not found or expired — refresh the quote and sign again",
  "-2": "Invalid signed transaction",
  "-3": "Invalid message bytes",
  "-1000": "Transaction failed to land on chain — try again",
  "-1001": "Unknown error while sending the transaction",
  "-1002": "Invalid transaction",
  "-1003": "Transaction is not fully signed",
  "-1004": "Invalid block height — the quote is too old, refresh and sign again",
  "-1005": "Transaction expired before it landed — refresh the quote and sign again",
  "-1006": "Timed out waiting for confirmation — check Solscan before retrying",
  "-1007": "Gasless swap not supported for this order",
  "-2000": "RFQ swap failed to land — try again",
  "-2001": "Unknown error on the RFQ swap",
  "-2002": "Invalid RFQ payload",
  "-2003": "RFQ quote expired — refresh the quote and sign again",
  "-2004": "Swap rejected by the market maker — try again",
  "6001": "Slippage tolerance exceeded — price moved, refresh and try again",
  "6017": "Output amount did not match (exact out)",
  "6024": "Insufficient funds",
};

export function execErrorText(code, raw) {
  const rawStr = raw ? String(raw).slice(0, 160) : "";
  if (code === null || code === undefined || code === "") return rawStr || "Swap failed";
  const t = EXEC_ERRORS[String(code)];
  if (!t) return rawStr ? `${rawStr} (code ${code})` : `Swap failed (code ${code})`;
  return rawStr && rawStr.toLowerCase() !== t.toLowerCase() ? `${t} [${rawStr}]` : t;
}
