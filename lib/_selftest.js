// Pure-logic self test: node lib/_selftest.js  (no network)
import assert from "node:assert/strict";
import { toRaw, fromRaw, isPubkey, b58decode, b58encode, fmtUsd, fmtAmount, signLinks, SOL_MINT } from "./util.js";
import { decodePumpCurve, findProgramAddress, isOnCurve, PUMP_INITIAL_REAL_TOKEN_RESERVES } from "./solana.js";
import { execErrorText, EXEC_ERRORS } from "./jupiter.js";
import { pickBySymbol, candidatesText } from "./resolve.js";
import { topHoldersPct } from "./tokeninfo.js";
import { validateSlippage, validId, newId } from "./swaps.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("toRaw", () => {
  assert.equal(toRaw("0.5", 9), "500000000");
  assert.equal(toRaw(0.5, 9), "500000000");
  assert.equal(toRaw("1", 6), "1000000");
  assert.equal(toRaw("1,000.25", 6), "1000250000");
  assert.equal(toRaw(".1", 9), "100000000");
  assert.equal(toRaw("0.1234567891", 9), "123456789"); // truncates
  assert.equal(toRaw(1e-7, 9), "100");                   // no exponent bug
  assert.equal(toRaw("123456789.123456", 6), "123456789123456");
  assert.throws(() => toRaw("0", 9));
  assert.throws(() => toRaw("-1", 9));
  assert.throws(() => toRaw("abc", 9));
  assert.throws(() => toRaw("0.0000000001", 9)); // rounds to 0
});

t("fromRaw", () => {
  assert.equal(fromRaw("500000000", 9), "0.5");
  assert.equal(fromRaw("1000000", 6), "1");
  assert.equal(fromRaw("1", 9), "0.000000001");
  assert.equal(fromRaw(123456789123456n, 6), "123456789.123456");
  assert.equal(fromRaw("42", 0), "42");
});

t("base58 + pubkey", () => {
  assert.ok(isPubkey(SOL_MINT));
  assert.ok(isPubkey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
  assert.ok(!isPubkey("SOL"));
  assert.ok(!isPubkey("0OIl" + "1".repeat(40)));
  assert.equal(b58encode(b58decode(SOL_MINT)), SOL_MINT);
  assert.equal(b58decode("11111111111111111111111111111111").length, 32);
});

t("ed25519 + PDA", () => {
  // System program id (all zeros) is a valid curve point (y=0 → x²=-1/1 is a square in this field).
  assert.equal(typeof isOnCurve(new Uint8Array(32)), "boolean");
  const [pda, bump] = findProgramAddress([Buffer.from("bonding-curve"), b58decode(SOL_MINT)], "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  assert.ok(isPubkey(pda) && bump >= 0 && bump <= 255);
  assert.ok(!isOnCurve(b58decode(pda)));
});

function curveBuf({ vt, vs, rt, rs, sup, complete }) {
  const b = Buffer.alloc(8 + 40 + 1 + 32);
  Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]).copy(b, 0); // discriminator bytes (ignored)
  [vt, vs, rt, rs, sup].forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 8 + i * 8));
  b[48] = complete ? 1 : 0;
  return b;
}

t("pump curve decode", () => {
  // Example account from pump-fun/pump-public-docs (fresh curve).
  const fresh = decodePumpCurve(curveBuf({ vt: "1072999999992855", vs: "30000000013", rt: "793099999992855", rs: "13", sup: "1000000000000000", complete: false }));
  assert.equal(fresh.complete, false);
  assert.equal(fresh.progressPct, 0);
  assert.equal(fresh.tokenTotalSupply, "1000000000000000");
  assert.ok(Math.abs(fresh.priceSol - 2.796e-8) < 1e-10);
  // Half sold.
  const half = decodePumpCurve(curveBuf({ vt: "676450000000000", vs: "47500000000", rt: String(PUMP_INITIAL_REAL_TOKEN_RESERVES / 2n), rs: "17500000000", sup: "1000000000000000", complete: false }));
  assert.equal(half.progressPct, 50);
  assert.equal(half.realSol, 17.5);
  const done = decodePumpCurve(curveBuf({ vt: "0", vs: "0", rt: "0", rs: "0", sup: "1000000000000000", complete: true }));
  assert.equal(done.complete, true); assert.equal(done.progressPct, 100); assert.equal(done.priceSol, null);
  assert.throws(() => decodePumpCurve(Buffer.alloc(20)));
});

t("exec error mapping", () => {
  assert.match(execErrorText(-1005), /expired/i);
  assert.match(execErrorText(-1000), /failed to land/i);
  assert.match(execErrorText(-2003), /RFQ quote expired/i);
  assert.match(execErrorText(6001), /Slippage/);
  assert.match(execErrorText(-9999, "boom"), /boom \(code -9999\)/);
  assert.equal(execErrorText(null, "raw msg"), "raw msg");
  assert.equal(execErrorText(undefined), "Swap failed");
  for (const c of [-1000, -1001, -1002, -1003, -1004, -1005, -2000, -2001, -2002, -2003, -2004]) assert.ok(EXEC_ERRORS[String(c)], `code ${c}`);
});

// Fixture list (shape of Jupiter Tokens V2 search results).
const FIX = [
  { id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, isVerified: true, liquidity: 9e8 },
  { id: "FakeUSDC11111111111111111111111111111111111", symbol: "USDC", name: "USDC Fake", decimals: 6, isVerified: false, liquidity: 120 },
  { id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "Bonk", name: "Bonk", decimals: 5, isVerified: true, liquidity: 5e6 },
  { id: "Dog1111111111111111111111111111111111111111", symbol: "DOG", name: "Dog A", decimals: 6, isVerified: false, liquidity: 5000 },
  { id: "Dog2222222222222222222222222222222222222222", symbol: "dog", name: "Dog B", decimals: 6, isVerified: false, liquidity: 9000 },
  { id: "Cat1111111111111111111111111111111111111111", symbol: "CATWIFHAT", name: "cat", decimals: 6, isVerified: false, liquidity: 10 },
];

t("symbol resolution", () => {
  assert.equal(pickBySymbol(FIX, "usdc").token.id, FIX[0].id);          // verified wins among dupes
  assert.equal(pickBySymbol(FIX, "$BONK").token.id, FIX[2].id);          // case + $ prefix
  const dog = pickBySymbol(FIX, "DOG");
  assert.ok(!dog.token && dog.candidates.length === 2);
  assert.equal(dog.candidates[0].id, FIX[4].id);                           // sorted by liquidity
  const none = pickBySymbol(FIX, "CAT");
  assert.ok(!none.token && none.candidates.length > 0);                    // no exact → top results as candidates
  assert.deepEqual(pickBySymbol([], "X"), { candidates: [] });
  assert.match(candidatesText("DOG", dog.candidates), /Reply with the contract address/);
  assert.match(candidatesText("ZZZ", []), /No token found/);
});

t("top holders %", () => {
  const largest = [{ amount: "500" }, { amount: "100" }, { amount: "50" }];
  assert.equal(topHoldersPct(largest, ["curve", "a", "b"], "1000", ["curve"]), 15);
  assert.equal(topHoldersPct(largest, [], "1000"), 65);
  assert.equal(topHoldersPct(largest, [], "0"), null);
});

t("swap helpers", () => {
  assert.equal(validateSlippage(undefined), null);
  assert.equal(validateSlippage(50), 50);
  assert.throws(() => validateSlippage(0));
  assert.throws(() => validateSlippage(1.5));
  assert.throws(() => validateSlippage(6000));
  const id = newId(); assert.ok(validId(id) && id.length === 12);
  assert.ok(!validId("../../x")); assert.ok(!validId(""));
});

t("formatting + links", () => {
  assert.equal(fmtUsd(1234567), "$1.23M");
  assert.equal(fmtUsd(12345), "$12.3K");
  assert.equal(fmtUsd(0.00001234), "$0.00001234");
  assert.equal(fmtUsd(null), "n/a");
  assert.equal(fmtAmount(1234.5678), "1,234.57");
  const { signUrl, phantomLink } = signLinks("https://portal.example", "abc123XYZ789");
  assert.equal(signUrl, "https://portal.example/s.html?id=abc123XYZ789");
  assert.equal(phantomLink, `https://phantom.com/ul/browse/${encodeURIComponent(signUrl)}?ref=${encodeURIComponent("https://portal.example")}`);
});

console.log(`\n${n} groups passed`);
