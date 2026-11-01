// POST /api/execute {id, requestId, signedTransaction} → Jupiter /swap/v2/execute, result stored on the intent.
import { execute } from "../lib/swaps.js";
import { json, UserError } from "../lib/util.js";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Body must be JSON" }, 400); }
  try {
    const r = await execute({ id: body?.id, requestId: body?.requestId, signedTransaction: body?.signedTransaction });
    return json(r, 200);
  } catch (e) {
    return json({ ok: false, status: "failed", error: e.message }, e instanceof UserError ? e.status : 502);
  }
}
