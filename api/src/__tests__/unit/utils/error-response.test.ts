import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { errorResponse } from "../../../utils/error-response.js";
import { AppError } from "../../../errors.js";

function makeApp(err: unknown, fallbackMessage?: string, fallbackStatus?: number) {
  const app = new Hono();
  app.get("/test", (c) => errorResponse(c, err, fallbackMessage, fallbackStatus));
  return app;
}

describe("errorResponse", () => {
  it("uses the AppError's own message and status code", async () => {
    const app = makeApp(new AppError("Match not found", 404));
    const res = await app.request("/test");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Match not found" });
  });

  it("falls back to a generic message and 500 for a plain Error", async () => {
    const app = makeApp(new Error("some internal detail"));
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
    // The real error message must never leak to the client
    expect(body.error).not.toContain("some internal detail");
  });

  it("falls back to a generic message and 500 for a thrown non-Error value", async () => {
    const app = makeApp("just a string");
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Internal server error" });
  });

  it("uses a custom fallback message and status when provided", async () => {
    const app = makeApp(new Error("oops"), "Submission failed", 400);
    const res = await app.request("/test");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Submission failed" });
  });

  it("an AppError's status code takes priority over a custom fallback status", async () => {
    const app = makeApp(new AppError("Conflict", 409), "Custom fallback", 400);
    const res = await app.request("/test");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: "Conflict" });
  });
});
