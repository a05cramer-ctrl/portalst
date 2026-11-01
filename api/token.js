// GET /api/token?mint= → same data as the token_info MCP tool, as JSON (website demo panel).
import { getTokenInfo, formatTokenInfo } from "../lib/tokeninfo.js";
import { json, UserError } from "../lib/util.js";

export async function GET(request) {
  try {
    const mint = new URL(request.url).searchParams.get("mint") || "";
    const data = await getTokenInfo(mint);
    // volume24h / change24h: aliases the website demo panel reads.
    return json({ ...data, volume24h: data.volume24hUsd, change24h: data.change24hPct, text: formatTokenInfo(data) }, 200, { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" });
  } catch (e) {
    return json({ error: e.message }, e instanceof UserError ? e.status : 502);
  }
}
