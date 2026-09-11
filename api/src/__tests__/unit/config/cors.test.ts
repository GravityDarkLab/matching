import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { buildCorsMiddleware } from "../../../config/cors.js";

// setup.ts doesn't set ALLOWED_ORIGINS, so env.ts falls back to its default
// of "http://localhost:3000" — the one origin these tests treat as allowed.
const ALLOWED_ORIGIN = "http://localhost:3000";

function makeApp() {
  const app = new Hono();
  app.use("*", buildCorsMiddleware());
  app.get("/test", (c) => c.json({ ok: true }));
  app.post("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("buildCorsMiddleware — simple requests", () => {
  it("reflects an allowed origin in Access-Control-Allow-Origin", async () => {
    const app = makeApp();
    const res = await app.request("/test", { headers: { origin: ALLOWED_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("omits Access-Control-Allow-Origin for a disallowed origin", async () => {
    const app = makeApp();
    const res = await app.request("/test", { headers: { origin: "http://evil.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects an origin that differs only by scheme", async () => {
    const app = makeApp();
    const res = await app.request("/test", { headers: { origin: "https://localhost:3000" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects an origin that differs only by port", async () => {
    const app = makeApp();
    const res = await app.request("/test", { headers: { origin: "http://localhost:3001" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("still succeeds with no Access-Control-Allow-Origin when no Origin header is sent (server-to-server)", async () => {
    const app = makeApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exposes X-Request-Id via Access-Control-Expose-Headers", async () => {
    const app = makeApp();
    const res = await app.request("/test", { headers: { origin: ALLOWED_ORIGIN } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
  });
});

describe("buildCorsMiddleware — preflight (OPTIONS) requests", () => {
  it("returns 204 with the configured methods, headers, and max-age for an allowed origin", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")?.split(",")).toEqual(
      ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    );
    expect(res.headers.get("Access-Control-Allow-Headers")?.split(",")).toEqual(
      ["Content-Type", "Authorization", "X-Submission-Key"]
    );
    expect(res.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  it("returns 204 but omits Access-Control-Allow-Origin for a disallowed origin", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        origin: "http://evil.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    // hono/cors still answers the preflight with 204 (it doesn't block at the
    // HTTP layer) — the browser is the one that withholds the response from JS
    // when Access-Control-Allow-Origin doesn't match.
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
