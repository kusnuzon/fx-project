/**
 * CEBONK XAUUSD DATA API — Cloudflare Worker
 * Backend aman kanggo GitHub Pages. API key Twelve Data disimpan sebagai Secret:
 *   TWELVE_DATA_KEY
 *
 * Endpoint:
 *   GET /health
 *   GET /xau?interval=5min&outputsize=300
 *
 * Sumber data: Twelve Data /time_series, symbol XAU/USD.
 */
const ALLOWED_ORIGIN = "https://enggarprasetiyodaviandhoni.github.io";
const ALLOWED_INTERVALS = new Set(["1min","5min","15min","30min","45min","1h","2h","4h"]);
const MAX_OUTPUTSIZE = 500;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, request, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...extra,
    },
  });
}

function ttlFor(interval) {
  if (interval === "1min") return 20;
  if (interval === "5min") return 45;
  if (interval === "15min") return 90;
  if (interval === "30min" || interval === "45min") return 150;
  return 240;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, request);
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "CEBONK XAUUSD DATA API",
        symbol: "XAU/USD",
        secretConfigured: Boolean(env.TWELVE_DATA_KEY),
        timeUtc: new Date().toISOString(),
      }, 200, request, { "Cache-Control": "no-store" });
    }

    if (url.pathname !== "/xau") {
      return json({ ok: false, error: "NOT_FOUND" }, 404, request);
    }

    if (!env.TWELVE_DATA_KEY) {
      return json({ ok: false, error: "TWELVE_DATA_KEY_NOT_CONFIGURED" }, 500, request);
    }

    const interval = url.searchParams.get("interval") || "5min";
    if (!ALLOWED_INTERVALS.has(interval)) {
      return json({
        ok: false,
        error: "INVALID_INTERVAL",
        allowed: [...ALLOWED_INTERVALS],
      }, 400, request);
    }

    let outputsize = Number.parseInt(url.searchParams.get("outputsize") || "300", 10);
    if (!Number.isFinite(outputsize)) outputsize = 300;
    outputsize = Math.max(50, Math.min(MAX_OUTPUTSIZE, outputsize));

    // Cache key ora tau ngemot API key.
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.set("interval", interval);
    cacheUrl.searchParams.set("outputsize", String(outputsize));
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const upstream = new URL("https://api.twelvedata.com/time_series");
    upstream.searchParams.set("symbol", "XAU/USD");
    upstream.searchParams.set("interval", interval);
    upstream.searchParams.set("outputsize", String(outputsize));
    upstream.searchParams.set("order", "DESC");
    upstream.searchParams.set("timezone", "UTC");
    upstream.searchParams.set("apikey", env.TWELVE_DATA_KEY);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstream.toString(), {
        headers: { "Accept": "application/json" },
      });
    } catch (err) {
      return json({
        ok: false,
        error: "UPSTREAM_NETWORK_ERROR",
        message: String(err?.message || err),
      }, 502, request);
    }

    let data;
    try {
      data = await upstreamResponse.json();
    } catch {
      return json({ ok: false, error: "UPSTREAM_INVALID_JSON" }, 502, request);
    }

    if (!upstreamResponse.ok || data?.status === "error") {
      return json({
        ok: false,
        error: "TWELVE_DATA_ERROR",
        upstreamStatus: upstreamResponse.status,
        code: data?.code ?? null,
        message: data?.message ?? "Unknown Twelve Data error",
      }, upstreamResponse.ok ? 502 : upstreamResponse.status, request, {
        "Cache-Control": "no-store",
      });
    }

    const values = Array.isArray(data?.values) ? data.values : [];
    const payload = {
      ok: true,
      provider: "Twelve Data",
      symbol: data?.meta?.symbol || "XAU/USD",
      interval,
      timezone: data?.meta?.exchange_timezone || "UTC",
      fetchedAtUtc: new Date().toISOString(),
      count: values.length,
      values: values.map(v => ({
        datetime: v.datetime,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: v.volume == null ? null : Number(v.volume),
      })),
    };

    const ttl = ttlFor(interval);
    const response = json(payload, 200, request, {
      "Cache-Control": `public, max-age=${ttl}`,
      "X-CEBONK-Cache-TTL": String(ttl),
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
