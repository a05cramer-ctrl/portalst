// Shared pure helpers: mints, amount conversion, formatting, base58, responses.
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_META = Object.freeze({
  mint: SOL_MINT,
  symbol: "SOL",
  name: "Wrapped SOL",
  decimals: 9,
  icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
});

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = Object.fromEntries([...B58].map((c, i) => [c, i]));

export function isBase58(s) {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

export function b58decode(s) {
  if (!isBase58(s)) throw new Error("not base58");
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58_MAP[c]);
  const bytes = [];
  while (n > 0n) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}

/** A Solana public key: base58 that decodes to exactly 32 bytes. */
export function isPubkey(s) {
  if (!isBase58(s) || s.length < 32 || s.length > 44) return false;
  try { return b58decode(s).length === 32; } catch { return false; }
}

/** "1.5" UI units → raw integer string, exact (no float math). Throws on bad input. */
export function toRaw(ui, decimals) {
  let s = typeof ui === "number"
    ? ui.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 })
    : String(ui ?? "").trim().replace(/[,_\s]/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error(`Invalid amount "${ui}"`);
  let [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) frac = frac.slice(0, decimals); // truncate extra precision
  const raw = BigInt((whole || "0") + frac.padEnd(decimals, "0"));
  if (raw <= 0n) throw new Error("Amount must be greater than 0");
  return raw.toString();
}

/** raw integer (string|bigint|number) → UI decimal string, trimmed. */
export function fromRaw(raw, decimals) {
  let v = BigInt(String(raw));
  const neg = v < 0n; if (neg) v = -v;
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

const n = (x) => (x === null || x === undefined || x === "" ? NaN : Number(x));

/** Compact USD: $1.23B, $4.5M, $12.3K, $1.23, $0.00001234 */
export function fmtUsd(x) {
  const v = n(x);
  if (!Number.isFinite(v)) return "n/a";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  if (a >= 1) return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  if (a === 0) return "$0";
  return `${sign}$${fmtSig(a, 4)}`;
}

/** Token amount: thousands separators, sensible precision. */
export function fmtAmount(x, maxFrac = 6) {
  const v = n(x);
  if (!Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: Math.min(maxFrac, 4) });
  return fmtSig(v, 4);
}

function fmtSig(v, sig) {
  // Avoid exponent notation for tiny values.
  const s = Number(v).toPrecision(sig);
  if (!/e/i.test(s)) return String(Number(s));
  return Number(s).toFixed(Math.min(20, Math.ceil(-Math.log10(Math.abs(v))) + sig - 1)).replace(/0+$/, "");
}

export function fmtPct(x, digits = 2) {
  const v = n(x);
  if (!Number.isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function shortAddr(a) {
  return typeof a === "string" && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a);
}

export const solscanTx = (sig) => `https://solscan.io/tx/${sig}`;
export const solscanToken = (mint) => `https://solscan.io/token/${mint}`;
export const solscanAccount = (a) => `https://solscan.io/account/${a}`;
export const dexscreenerToken = (mint) => `https://dexscreener.com/solana/${mint}`;
export const pumpfunCoin = (mint) => `https://pump.fun/coin/${mint}`;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** Public origin: SITE_URL env, else forwarded headers, else request URL. */
export function publicOrigin(request) {
  const env = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  if (!request) return "";
  const h = request.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = (h.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (host) return `${proto || (host.startsWith("localhost") ? "http" : "https")}://${host.split(",")[0].trim()}`;
  try { return new URL(request.url).origin; } catch { return ""; }
}

export function signLinks(origin, id) {
  const signUrl = `${origin}/s.html?id=${encodeURIComponent(id)}`;
  const phantomLink = `https://phantom.com/ul/browse/${encodeURIComponent(signUrl)}?ref=${encodeURIComponent(origin)}`;
  return { signUrl, phantomLink };
}

export class UserError extends Error {
  constructor(message, status = 400, extra) { super(message); this.status = status; this.extra = extra; }
}
