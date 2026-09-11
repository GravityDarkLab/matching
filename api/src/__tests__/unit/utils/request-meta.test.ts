import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { getClientIp, getRequestMeta } from "../../../utils/request-meta.js";

// trustProxy passed explicitly: these tests pin the behavior of each mode
// rather than inheriting whatever setup.ts sets TRUST_PROXY to.
function makeApp(trustProxy: boolean) {
  const app = new Hono();
  app.get("/ip", (c) => c.json({ ip: getClientIp(c, trustProxy) }));
  app.get("/meta", (c) => c.json(getRequestMeta(c, trustProxy)));
  return app;
}

describe("getClientIp — untrusted (no proxy in front, the default)", () => {
  it("ignores X-Forwarded-For — a direct client must not choose its own rate-limit/audit IP", async () => {
    const app = makeApp(false);
    const res = await app.request("/ip", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    // In-memory test client has no socket either, so the fallback chain
    // bottoms out at "unknown" — the point is the spoofed header is not it.
    expect((await res.json()).ip).toBe("unknown");
  });

  it("ignores X-Real-IP for the same reason", async () => {
    const app = makeApp(false);
    const res = await app.request("/ip", { headers: { "x-real-ip": "5.6.7.8" } });
    expect((await res.json()).ip).toBe("unknown");
  });
});

describe("getClientIp — behind a trusted proxy (TRUST_PROXY=true)", () => {
  it("prefers X-Forwarded-For over X-Real-IP", async () => {
    const app = makeApp(true);
    const res = await app.request("/ip", {
      headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" },
    });
    expect((await res.json()).ip).toBe("1.2.3.4");
  });

  it("takes the LAST IP from a comma-separated X-Forwarded-For chain — the one hop away from a single trusted proxy", async () => {
    const app = makeApp(true);
    const res = await app.request("/ip", {
      headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9, 8.8.8.8" },
    });
    // Not "1.2.3.4" — nginx's $proxy_add_x_forwarded_for APPENDS to whatever
    // the client sent, so every entry except the last is client-supplied and
    // spoofable; only the rightmost one hop in was added by our own proxy.
    expect((await res.json()).ip).toBe("8.8.8.8");
  });

  it("is not fooled by a client prepending fake hops onto X-Forwarded-For", async () => {
    const app = makeApp(true);
    // Simulates what actually reaches the API through frontend/nginx.conf's
    // $proxy_add_x_forwarded_for: whatever the client sent, then the real
    // connecting address nginx observed, appended at the end.
    const res = await app.request("/ip", {
      headers: { "x-forwarded-for": "9.9.9.9, 9.9.9.9, 9.9.9.9, 203.0.113.7" },
    });
    expect((await res.json()).ip).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", async () => {
    const app = makeApp(true);
    const res = await app.request("/ip", { headers: { "x-real-ip": "5.6.7.8" } });
    expect((await res.json()).ip).toBe("5.6.7.8");
  });

  it("falls back to 'unknown' when no headers and no real socket are present (test client)", async () => {
    const app = makeApp(true);
    const res = await app.request("/ip");
    // getConnInfo throws outside a real Bun server (Hono's in-memory test client) —
    // getClientIp must degrade to "unknown" rather than crashing the request.
    expect(res.status).toBe(200);
    expect((await res.json()).ip).toBe("unknown");
  });
});

describe("getRequestMeta", () => {
  it("returns both ipAddress and userAgent", async () => {
    const app = makeApp(true);
    const res = await app.request("/meta", {
      headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "TestAgent/1.0" },
    });
    expect(await res.json()).toEqual({ ipAddress: "1.2.3.4", userAgent: "TestAgent/1.0" });
  });

  it("defaults userAgent to 'unknown' when absent", async () => {
    const app = makeApp(true);
    const res = await app.request("/meta", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect((await res.json()).userAgent).toBe("unknown");
  });
});
