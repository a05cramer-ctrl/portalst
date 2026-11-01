// Upstash Redis (Vercel Marketplace env names) with an in-memory fallback for local dev.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

let redis = null;
if (url && token) redis = new Redis({ url, token });

const mem = new Map(); // key -> { v, exp }

export const kvMode = redis ? "redis" : "memory";

export async function kvGet(key) {
  if (redis) {
    const v = await redis.get(key); // @upstash/redis auto-deserializes JSON
    return v ?? null;
  }
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) { mem.delete(key); return null; }
  return structuredClone(e.v);
}

export async function kvSet(key, value, exSeconds) {
  if (redis) {
    if (exSeconds) await redis.set(key, value, { ex: exSeconds });
    else await redis.set(key, value);
    return;
  }
  mem.set(key, { v: structuredClone(value), exp: exSeconds ? Date.now() + exSeconds * 1000 : 0 });
}

/** Read-through cache; errors in the store never break the lookup. */
export async function cached(key, ttlSeconds, fn) {
  try {
    const hit = await kvGet(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch {}
  const v = await fn();
  try { await kvSet(key, v, ttlSeconds); } catch {}
  return v;
}

export function _memClear() { mem.clear(); }
