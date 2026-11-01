// GET /api/swap?id= → stored swap intent (public fields).
import { getIntent, publicIntent } from "../lib/swaps.js";
import { json, UserError } from "../lib/util.js";

export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    const it = await getIntent(id);
    if (!it) return json({ error: "Swap not found or expired — ask for a new swap link" }, 404);
    return json(publicIntent(it));
  } catch (e) {
    return json({ error: e.message }, e instanceof UserError ? e.status : 500);
  }
}
