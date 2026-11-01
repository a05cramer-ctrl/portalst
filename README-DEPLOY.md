# PORTAL — deploy

Plain Vercel project (no framework). Static `index.html` / `s.html` + Node 24 functions in `api/`.

## 1. Deploy
1. Push `site/` to a GitHub repo (`.gitignore` already skips `.env*`, `node_modules`, `.vercel`).
2. Vercel → Add New → Project → import the repo. Framework preset: **Other**. Root directory: the folder that holds `package.json`. No build command, no output directory.
3. Storage → Marketplace → **Upstash for Redis** → connect to the project (adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically).
4. Settings → Environment Variables (names only, set the values in Vercel):
   - `HELIUS_API_KEY` — required for wallet_holdings, holder %, pump.fun curve and fresh-mint decimals (free tier works).
   - `JUPITER_API_KEY` — optional (free key from portal.jup.ag raises the rate limit from 0.5 to 1 RPS).
   - `SITE_URL` — your public origin, e.g. `https://portal.xyz` (no trailing slash). Used for signing links; falls back to the request host.
5. Redeploy after adding env vars.

## 2. Check it
- `https://<site>/api/token?mint=So11111111111111111111111111111111111111112` → JSON with price.
- Connector URL: `https://<site>/api/mcp` (POST JSON-RPC, Streamable HTTP; GET answers 405 — stateless, expected).
- Optional: `npx @modelcontextprotocol/inspector` → Streamable HTTP → the URL above → list tools → call `token_info`.

## 3. Add the connector
- Claude: Customize → Connectors → + Add → Add custom connector → name `PORTAL`, URL `https://<site>/api/mcp` → Authentication "No sign-in" → Add → in a chat "+" → Connectors → turn PORTAL on.
- ChatGPT (Plus/Pro/Business, web): Settings → Apps → Advanced → Developer mode on → Create app → URL + No Authentication → in a chat "+" → Developer mode → PORTAL.

## Endpoints
| Route | Use |
|---|---|
| `POST /api/mcp` | MCP tools: token_info, quote, prepare_swap, swap_status, wallet_holdings |
| `GET /api/swap?id=` | stored swap intent (10 min) |
| `GET /api/order?id=&taker=` | fresh Jupiter Swap V2 order for the connected wallet (unsigned base64 tx) |
| `POST /api/execute` `{id, requestId, signedTransaction}` | forwards the signed tx to Jupiter `/swap/v2/execute`, stores the result |
| `GET /api/token?mint=` | token_info as JSON for the website demo (CDN cached 15 s) |

Non-custodial: the server never sees a private key. It builds an unsigned transaction, the user signs in Phantom, the server only relays the signed bytes to Jupiter.

## Local
`npm i && npm run check && npm run selftest`. Without Upstash env vars, storage falls back to in-memory (dev only — on Vercel always connect Upstash, or swap links break across function instances).
