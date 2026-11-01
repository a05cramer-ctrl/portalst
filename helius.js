// Helius RPC (HELIUS_API_KEY). Standard JSON-RPC methods only.
import { fetchJson } from "./http.js";
import { decodePumpCurve, pumpCurvePda, PUMP_PROGRAM } from "./solana.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const heliusConfigured = () => !!process.env.HELIUS_API_KEY;

async function rpc(method, params) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set on the server");
  const r = await fetchJson(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`, {
    method: "POST",
    body: { jsonrpc: "2.0", id: 1, method, params },
    timeoutMs: 12000,
  });
  if (!r.ok) throw new Error(`RPC ${method} failed (HTTP ${r.status})`);
  if (r.data?.error) throw new Error(`RPC ${method}: ${r.data.error.message || JSON.stringify(r.data.error)}`);
  return r.data?.result;
}

export async function getSolBalance(owner) {
  const res = await rpc("getBalance", [owner, { commitment: "confirmed" }]);
  return (res?.value ?? 0) / 1e9;
}

/** Non-zero SPL + Token-2022 balances: [{mint, amount (UI number), uiAmountString, decimals, program}] */
export async function getTokenBalances(owner) {
  const progs = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM];
  const results = await Promise.all(progs.map((programId) =>
    rpc("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }])));
  const byMint = new Map();
  results.forEach((res, i) => {
    for (const acc of res?.value || []) {
      const info = acc?.account?.data?.parsed?.info;
      const ta = info?.tokenAmount;
      if (!info?.mint || !ta || ta.amount === "0") continue;
      const prev = byMint.get(info.mint);
      const amt = Number(ta.uiAmountString ?? ta.uiAmount ?? 0);
      if (prev) prev.amount += amt;
      else byMint.set(info.mint, { mint: info.mint, amount: amt, decimals: ta.decimals, program: i ? "token-2022" : "spl" });
    }
  });
  return [...byMint.values()];
}

export async function getTokenSupply(mint) {
  const res = await rpc("getTokenSupply", [mint]);
  return res?.value; // {amount, decimals, uiAmount, uiAmountString}
}

export async function getLargestAccounts(mint) {
  const res = await rpc("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
  return res?.value || []; // [{address, amount, decimals, uiAmount, uiAmountString}]
}

/** Account owners for token accounts (to label curve/pool accounts). */
export async function getMultipleAccountsParsed(addresses) {
  const res = await rpc("getMultipleAccounts", [addresses, { encoding: "jsonParsed" }]);
  return res?.value || [];
}

/** pump.fun bonding curve state, or null if the mint has no curve account. */
export async function getPumpCurve(mint) {
  const pda = pumpCurvePda(mint);
  const res = await rpc("getAccountInfo", [pda, { encoding: "base64", commitment: "confirmed" }]);
  const v = res?.value;
  if (!v || !Array.isArray(v.data) || (v.owner && v.owner !== PUMP_PROGRAM)) return null;
  return { address: pda, ...decodePumpCurve(Buffer.from(v.data[0], "base64")) };
}
