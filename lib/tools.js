// MCP tool implementations → plain text answers (shared by api/mcp.js).
import { getTokenInfo, formatTokenInfo } from "./tokeninfo.js";
import { quote, createIntent, getIntent } from "./swaps.js";
import { getPrices, searchTokens } from "./jupiter.js";
import { getSolBalance, getTokenBalances } from "./helius.js";
import { SOL_MINT, isPubkey, UserError, fmtUsd, fmtAmount, fmtPct, signLinks, solscanTx, solscanAccount, dexscreenerToken, shortAddr } from "./util.js";

export async function tokenInfoText({ mint }) {
  return formatTokenInfo(await getTokenInfo(mint));
}

function impactLine(pi) {
  if (pi === null || pi === undefined || !Number.isFinite(pi)) return "Price impact: n/a";
  const warn = Math.abs(pi) >= 5 ? "  ← HIGH, consider a smaller size" : "";
  return `Price impact: ${Math.abs(pi) < 0.01 ? "<0.01" : Math.abs(pi).toFixed(2)}%${warn}`;
}

export async function quoteText({ inputMint, outputMint, amount, slippageBps }) {
  const q = await quote({ input: inputMint, output: outputMint, amount, slippageBps });
  const L = [
    `Quote (Jupiter): ${fmtAmount(q.amount)} ${q.input.symbol} → ~${fmtAmount(q.outAmount)} ${q.output.symbol}`,
    impactLine(q.priceImpactPct),
  ];
  if (q.minOut) L.push(`Minimum received: ${fmtAmount(q.minOut)} ${q.output.symbol}${q.slippageBps != null ? ` (slippage ${(q.slippageBps / 100).toFixed(2)}%)` : ""}`);
  if (q.router) L.push(`Router: ${q.router}${q.routeLabels.length ? ` (${q.routeLabels.join(" → ")})` : ""}`);
  L.push(`${q.input.symbol}: ${q.input.mint}`, `${q.output.symbol}: ${q.output.mint}`);
  if (q.output.mint !== SOL_MINT) L.push(`Chart: ${dexscreenerToken(q.output.mint)}`);
  L.push(`Quotes move fast. To actually swap, use prepare_swap — the user signs in their own wallet.`);
  return L.join("\n");
}

export async function prepareSwapText({ input, output, amount, slippageBps }, origin) {
  const it = await createIntent({ input, output, amount, slippageBps });
  const { signUrl, phantomLink } = signLinks(origin, it.id);
  let est = "";
  try {
    const q = await quote({ input: it.input.mint, output: it.output.mint, amount: it.amount, slippageBps: it.slippageBps });
    est = `~${fmtAmount(q.outAmount)} ${it.output.symbol} at current price (${impactLine(q.priceImpactPct).toLowerCase()})`;
  } catch {}
  const summary = `Swap ${fmtAmount(it.amount)} ${it.input.symbol} → ${it.output.symbol}${it.slippageBps ? ` · slippage ${(it.slippageBps / 100).toFixed(2)}%` : " · auto slippage"}`;
  const L = [
    `Swap ready: ${summary}`,
    est ? `Estimate: ${est}` : null,
    `${it.input.symbol}: ${it.input.mint}`,
    `${it.output.symbol}: ${it.output.mint}`,
    ``,
    `Sign here (link valid 10 min, until ${it.expiresAt}):`,
    signUrl,
    `On mobile, open in the Phantom app: ${phantomLink}`,
    ``,
    `Steps: open the link → Connect Phantom → review the fresh quote → Sign. The transaction is built for whichever wallet connects; PORTAL never holds keys or funds.`,
    `When done, ask "check my swap" (swap id: ${it.id}).`,
  ].filter((x) => typeof x === "string");
  return { text: L.join("\n"), intent: it, signUrl, phantomLink, summary };
}

export async function swapStatusText({ id }) {
  const it = await getIntent(String(id || "").trim());
  if (!it) return `No swap found for id "${id}". Links expire after 10 minutes if not signed — prepare a new swap.`;
  const label = { pending: "pending (not signed yet)", sent: "sent (waiting for confirmation)", success: "confirmed", failed: "failed", expired: "expired (never signed)" }[it.status] || it.status;
  const L = [`Swap ${it.id}: ${label}`, `${fmtAmount(it.amount)} ${it.input.symbol} → ${it.output.symbol}`];
  if (it.status === "success") {
    if (it.outAmountExecuted) L.push(`Received: ${fmtAmount(it.outAmountExecuted)} ${it.output.symbol}${it.inAmountExecuted ? ` for ${fmtAmount(it.inAmountExecuted)} ${it.input.symbol}` : ""}`);
  }
  if (it.status === "failed" && it.error) L.push(`Error: ${it.error}${it.code != null ? ` (code ${it.code})` : ""}`);
  if (it.signature) L.push(`Signature: ${it.signature}`, `Solscan: ${solscanTx(it.signature)}`);
  if (it.status === "pending") L.push(`Expires: ${it.expiresAt}`);
  if (it.output.mint !== SOL_MINT) L.push(`Chart: ${dexscreenerToken(it.output.mint)}`);
  return L.join("\n");
}

export async function walletHoldings(wallet) {
  const w = String(wallet || "").trim();
  if (!isPubkey(w)) throw new UserError(`"${w.slice(0, 60)}" is not a valid Solana wallet address`);
  const [sol, toks] = await Promise.all([getSolBalance(w), getTokenBalances(w)]);
  const mints = [SOL_MINT, ...toks.map((t) => t.mint)];
  let prices = {};
  try { prices = await getPrices(mints); } catch {}
  const rows = toks.map((t) => {
    const p = prices[t.mint]?.usdPrice;
    return { ...t, usdPrice: p ?? null, usd: p != null ? p * t.amount : null, change24h: prices[t.mint]?.priceChange24h ?? null };
  }).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.amount - a.amount);
  // names for the top rows (one search call, comma-separated mints)
  const top = rows.slice(0, 25);
  try {
    if (top.length) {
      const meta = await searchTokens(top.map((r) => r.mint).join(","));
      const by = new Map(meta.map((m) => [m.id, m]));
      for (const r of top) { const m = by.get(r.mint); if (m) { r.symbol = m.symbol; r.name = m.name; } }
    }
  } catch {}
  const solPrice = prices[SOL_MINT]?.usdPrice ?? null;
  const solUsd = solPrice != null ? solPrice * sol : null;
  const total = (solUsd || 0) + rows.reduce((s, r) => s + (r.usd || 0), 0);
  return { wallet: w, sol, solUsd, solPrice, tokens: rows, totalUsd: total, priced: rows.filter((r) => r.usd != null).length };
}

export async function walletHoldingsText({ wallet }) {
  const h = await walletHoldings(wallet);
  const L = [`Wallet ${shortAddr(h.wallet)} — total ≈ ${fmtUsd(h.totalUsd)} (priced holdings)`];
  L.push(`SOL: ${fmtAmount(h.sol)}${h.solUsd != null ? ` (${fmtUsd(h.solUsd)})` : ""}`);
  if (!h.tokens.length) L.push("No SPL tokens with a balance.");
  const shown = h.tokens.slice(0, 25);
  for (const r of shown) {
    L.push(`- ${r.symbol ? `$${r.symbol}` : shortAddr(r.mint)}: ${fmtAmount(r.amount)}${r.usd != null ? ` · ${fmtUsd(r.usd)}` : " · no price"}${r.change24h != null ? ` · 24h ${fmtPct(r.change24h)}` : ""} · ${r.mint}`);
  }
  if (h.tokens.length > shown.length) L.push(`…and ${h.tokens.length - shown.length} more token accounts (smallest/unpriced).`);
  L.push(`Solscan: ${solscanAccount(h.wallet)}`);
  return L.join("\n");
}
