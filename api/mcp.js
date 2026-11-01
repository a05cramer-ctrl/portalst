// PORTAL remote MCP server (Streamable HTTP) at /api/mcp. No auth, non-custodial.
import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { tokenInfoText, quoteText, prepareSwapText, swapStatusText, walletHoldingsText } from "../lib/tools.js";
import { publicOrigin, UserError } from "../lib/util.js";

const reqCtx = new AsyncLocalStorage();

const ok = (text, structuredContent) => ({ content: [{ type: "text", text }], ...(structuredContent ? { structuredContent } : {}) });
const fail = (e) => ({
  isError: true,
  content: [{ type: "text", text: e instanceof UserError ? e.message : `Error: ${e?.message || String(e)}` }],
});
const wrap = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

const amount = z.union([z.number().positive(), z.string().min(1)])
  .describe('Amount of the INPUT token in normal units, e.g. 0.5 for 0.5 SOL (not lamports)');
const tokenRef = (what) => z.string().min(1).describe(`${what}: "SOL", a token symbol, or a Solana contract address (mint). Prefer the contract address.`);
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const handler = createMcpHandler((server) => {
  server.registerTool("token_info", {
    title: "Token info",
    description: "Look up a Solana token by contract address (mint): name, symbol, price, market cap, liquidity, 24h volume and change, holders and top-10 concentration, pump.fun bonding-curve progress if still on the curve, mint/freeze authority, and DexScreener/Solscan/pump.fun links. Live data from Jupiter, DexScreener and Solana RPC.",
    inputSchema: z.object({ mint: z.string().min(1).describe("Token contract address (mint), or \"SOL\"") }),
    annotations: READ,
  }, wrap(async ({ mint }) => ok(await tokenInfoText({ mint }))));

  server.registerTool("quote", {
    title: "Swap quote",
    description: "Get a real Jupiter swap quote on Solana: expected output, price impact, minimum received and route. Read-only; nothing is signed or sent.",
    inputSchema: z.object({
      inputMint: tokenRef("Token to sell"),
      outputMint: tokenRef("Token to buy"),
      amount,
      slippageBps: z.number().int().min(1).max(5000).optional().describe("Optional slippage in basis points (100 = 1%). Omit for Jupiter's automatic slippage."),
    }),
    annotations: READ,
  }, wrap(async (a) => ok(await quoteText(a))));

  server.registerTool("prepare_swap", {
    title: "Prepare swap",
    description: "Prepare a Solana token swap via Jupiter and return a signing link. Moves no funds: the user opens the link, connects their own wallet (Phantom), reviews a fresh quote and signs it themselves. The link is valid for 10 minutes. Always show the user the sign link and the phantom link. Afterwards use swap_status with the returned id.",
    inputSchema: z.object({
      input: tokenRef("Token to sell"),
      output: tokenRef("Token to buy"),
      amount,
      slippageBps: z.number().int().min(1).max(5000).optional().describe("Optional slippage in basis points (100 = 1%). Omit for automatic."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, wrap(async (a) => {
    const origin = reqCtx.getStore()?.origin || "";
    const r = await prepareSwapText(a, origin);
    return ok(r.text, { id: r.intent.id, signUrl: r.signUrl, phantomLink: r.phantomLink, summary: r.summary, expiresAt: r.intent.expiresAt });
  }));

  server.registerTool("swap_status", {
    title: "Swap status",
    description: "Check a swap prepared with prepare_swap: pending, sent, confirmed or failed, with the transaction signature and Solscan link.",
    inputSchema: z.object({ id: z.string().min(1).describe("Swap id returned by prepare_swap") }),
    annotations: { ...READ, idempotentHint: false },
  }, wrap(async ({ id }) => ok(await swapStatusText({ id }))));

  server.registerTool("wallet_holdings", {
    title: "Wallet holdings",
    description: "List a Solana wallet's SOL and SPL / Token-2022 balances with USD values (Jupiter prices), sorted by value.",
    inputSchema: z.object({ wallet: z.string().min(1).describe("Solana wallet address") }),
    annotations: READ,
  }, wrap(async ({ wallet }) => ok(await walletHoldingsText({ wallet }))));
}, {
  serverInfo: { name: "PORTAL", version: "1.0.0" },
  instructions: "PORTAL reads Solana chain data and builds real Jupiter swaps. It is non-custodial: prepare_swap only returns a link; the user signs in their own wallet. Never claim a swap happened until swap_status says confirmed.",
});

async function serve(request) {
  return reqCtx.run({ origin: publicOrigin(request) }, () => handler(request));
}

export async function GET(request) { return serve(request); }
export async function POST(request) { return serve(request); }
export async function DELETE(request) { return serve(request); }
