// fetch with timeout, JSON parse, one retry on 429/5xx.
export async function fetchJson(url, { method = "GET", headers = {}, body, timeoutMs = 10000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, res.status === 429 ? 1200 : 400));
        continue;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) { await new Promise((r) => setTimeout(r, 300)); continue; }
    } finally {
      clearTimeout(t);
    }
  }
  const msg = lastErr?.name === "AbortError" ? "request timed out" : (lastErr?.message || "network error");
  return { ok: false, status: 0, data: { error: msg } };
}
