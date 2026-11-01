// GET /api/order?id=&taker= → fresh Jupiter Swap V2 order (unsigned tx) for this wallet.
import { buildOrder } from "../lib/swaps.js";
import { json, UserError } from "../lib/util.js";

export async function GET(request) {
  try {
    const p = new URL(request.url).searchParams;
    return json(await buildOrder(p.get("id") || "", p.get("taker") || ""));
  } catch (e) {
    return json({ error: e.message }, e instanceof UserError ? e.status : 502);
  }
}
