// Swap intents (10 min) + fresh Jupiter orders for whoever connects + execute.
import { randomBytes } from "node:crypto";
import { kvGet, kvSet } from "./kv.js";
import { resolveToken } from "./resolve.js";
import { getOrder, executeOrder, execErrorText } from "./jupiter.js";
import { toRaw, fromRaw, isPubkey, UserError, solscanTx, SOL_MINT } from "./util.js";

export const INTENT_TTL = 600;          // seconds an unsigned intent lives
const DONE_TTL = 86400;                 // keep executed swaps readable for a day
const ALPH = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const key = (id) => `swap:${id}`;

export function newId(len = 12) {
  const b = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPH[b[i] % ALPH.length];
  return s;
}

export function validId(id) { return typeof id === "string" && /^[A-Za-z0-9]{6,32}$/.test(id); }

export function validateSlippage(slippageBps) {
  if (slippageBps === undefined || slippageBps === null || slippageBps === "") return null;
  const v = Number(slippageBps);
  if (!Number.isInteger(v) || v < 1 || v > 5000) throw new UserError("slippageBps must be an integer between 1 and 5000 (0.01%–50%)");
  return v;
}

const sideOf = (m) => ({ mint: m.mint, symbol: m.symbol, decimals: m.decimals, icon: m.icon || null });

/** Resolve both tokens + raw amount. Shared by quote and prepare_swap. */
export async function resolvePair(input, output, amount) {
  const [inp, out] = await Promise.all([resolveToken(input), resolveToken(output)]);
  if (inp.mint === out.mint) throw new UserError("Input and output are the same token");
  const raw = toRaw(amount, inp.decimals);
  return { inp, out, raw };
}

export function summarizeOrder(o, inp, out) {
  const outUi = o.outAmount != null ? fromRaw(o.outAmount, out.decimals) : null;
  const inUi = o.inAmount != null ? fromRaw(o.inAmount, inp.decimals) : null;
  const minOut = o.otherAmountThreshold != null ? fromRaw(o.otherAmountThreshold, out.decimals) : null;
  const pi = o.priceImpact ?? o.priceImpactPct;
  return {
    inAmount: inUi,
    outAmount: outUi,
    minOut,
    priceImpactPct: pi === undefined || pi === null ? null : Number(pi),
    router: o.router || (Array.isArray(o.routePlan) ? o.routePlan.map((r) => r?.swapInfo?.label).filter(Boolean).join(" → ") : null) || null,
    routeLabels: Array.isArray(o.routePlan) ? o.routePlan.map((r) => r?.swapInfo?.label).filter(Boolean) : [],
    slippageBps: o.slippageBps ?? null,
    requestId: o.requestId || null,
    expireAt: o.expireAt || null,
    lastValidBlockHeight: o.lastValidBlockHeight ?? null,
  };
}

export async function quote({ input, output, amount, slippageBps }) {
  const { inp, out, raw } = await resolvePair(input, output, amount);
  const o = await getOrder({ inputMint: inp.mint, outputMint: out.mint, amount: raw, slippageBps: validateSlippage(slippageBps) });
  return { input: sideOf(inp), output: sideOf(out), amount: fromRaw(raw, inp.decimals), ...summarizeOrder(o, inp, out) };
}

export async function createIntent({ input, output, amount, slippageBps }) {
  const slip = validateSlippage(slippageBps);
  const { inp, out, raw } = await resolvePair(input, output, amount);
  const now = Date.now();
  const intent = {
    id: newId(),
    input: sideOf(inp),
    output: sideOf(out),
    amount: fromRaw(raw, inp.decimals),
    amountRaw: raw,
    slippageBps: slip,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INTENT_TTL * 1000).toISOString(),
    status: "pending",
  };
  await kvSet(key(intent.id), intent, INTENT_TTL);
  return intent;
}

/** Stored intent with derived expiry; null if unknown. */
export async function getIntent(id) {
  if (!validId(id)) throw new UserError("Invalid swap id");
  const it = await kvGet(key(id));
  if (!it) return null;
  if (it.status === "pending" && Date.parse(it.expiresAt) < Date.now()) it.status = "expired";
  return it;
}

/** Public shape for api/swap.js (no internal fields). */
export function publicIntent(it) {
  const { amountRaw, lastOrder, ...rest } = it;
  return rest;
}

async function save(it, ttl) {
  const left = Math.max(1, Math.ceil((Date.parse(it.expiresAt) - Date.now()) / 1000));
  await kvSet(key(it.id), it, ttl ?? left);
}

/** Fresh order for this taker. */
export async function buildOrder(id, taker) {
  if (!isPubkey(taker)) throw new UserError("taker must be a Solana wallet address");
  const it = await getIntent(id);
  if (!it) throw new UserError("Swap not found or expired — ask for a new swap link", 404);
  if (it.status === "success") throw new UserError("This swap was already executed", 409);
  if (it.status === "expired" || Date.parse(it.expiresAt) < Date.now()) throw new UserError("This swap link expired (10 min) — ask for a new one", 410);
  if (it.status === "sent" && Date.now() - Date.parse(it.sentAt || 0) < 90000) throw new UserError("This swap is being sent — wait for the result", 409);
  const o = await getOrder({ inputMint: it.input.mint, outputMint: it.output.mint, amount: it.amountRaw, taker, slippageBps: it.slippageBps });
  if (!o.transaction) {
    const why = o.errorMessage || o.error || (o.errorCode ? `code ${o.errorCode}` : "");
    throw new UserError(`Jupiter could not build a transaction for this wallet${why ? `: ${why}` : ""}`, 400);
  }
  const s = summarizeOrder(o, it.input, it.output);
  it.lastOrder = { requestId: s.requestId, lastValidBlockHeight: s.lastValidBlockHeight, taker, at: new Date().toISOString() };
  if (it.status === "failed") { it.status = "pending"; delete it.error; delete it.code; }
  await save(it);
  return {
    id: it.id,
    transaction: o.transaction,
    requestId: s.requestId,
    inAmount: s.inAmount,
    outAmount: s.outAmount,
    priceImpactPct: s.priceImpactPct,
    router: s.router,
    minOut: s.minOut,
    expireAt: s.expireAt,
    lastValidBlockHeight: s.lastValidBlockHeight,
  };
}

export async function execute({ id, requestId, signedTransaction }) {
  if (typeof signedTransaction !== "string" || signedTransaction.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(signedTransaction))
    throw new UserError("signedTransaction must be a base64 string");
  if (typeof requestId !== "string" || !requestId) throw new UserError("requestId is required");
  const it = await getIntent(id);
  if (!it) throw new UserError("Swap not found or expired", 404);
  if (it.status === "success") throw new UserError("This swap was already executed", 409);
  const lvbh = it.lastOrder?.requestId === requestId ? it.lastOrder.lastValidBlockHeight : undefined;

  it.status = "sent"; it.sentAt = new Date().toISOString(); it.requestId = requestId;
  await kvSet(key(it.id), it, DONE_TTL);

  const r = await executeOrder({ signedTransaction, requestId, lastValidBlockHeight: lvbh });
  const ok = r.status === "Success";
  it.status = ok ? "success" : "failed";
  it.signature = r.signature || null;
  it.executedAt = new Date().toISOString();
  if (ok) {
    delete it.error; delete it.code;
    const tin = r.totalInputAmount ?? r.inputAmountResult, tout = r.totalOutputAmount ?? r.outputAmountResult;
    if (tin != null) it.inAmountExecuted = fromRaw(tin, it.input.decimals);
    if (tout != null) it.outAmountExecuted = fromRaw(tout, it.output.decimals);
    if (r.slot != null) it.slot = r.slot;
  } else {
    it.code = r.code ?? null;
    it.error = execErrorText(r.code, r.error);
  }
  await kvSet(key(it.id), it, DONE_TTL);
  return {
    ok,
    status: it.status,
    signature: it.signature || undefined,
    code: ok ? undefined : it.code,
    error: ok ? undefined : it.error,
    solscan: it.signature ? solscanTx(it.signature) : undefined,
    inAmount: it.inAmountExecuted,
    outAmount: it.outAmountExecuted,
  };
}

export const isSol = (m) => m === SOL_MINT;
