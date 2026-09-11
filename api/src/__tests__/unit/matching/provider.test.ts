import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  getEmbeddingProvider,
  resetEmbeddingProvider,
} from "../../../matching/embeddings/provider.js";

// Reset singleton before every test — ensures each test gets a fresh instance.
beforeEach(() => resetEmbeddingProvider());
// Restore any lingering fetch spy so calls don't bleed between tests.
afterEach(() => resetEmbeddingProvider());

// ─── Helper: build a minimal valid OpenAI embeddings response ────────────────

function mockEmbeddingsResponse(embeddings: number[][]): Response {
  const body = {
    object: "list",
    data: embeddings.map((embedding, index) => ({ object: "embedding", index, embedding })),
    model: process.env.EMBEDDING_MODEL!,
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Provider instantiation ───────────────────────────────────────────────────

describe("getEmbeddingProvider — instantiation", () => {
  it("is always the openai provider", () => {
    const provider = getEmbeddingProvider();
    expect(provider.name).toBe("openai");
  });

  it("is a singleton — two calls return the same instance", () => {
    const a = getEmbeddingProvider();
    const b = getEmbeddingProvider();
    expect(a).toBe(b);
  });

  it("resets the singleton after resetEmbeddingProvider()", () => {
    const a = getEmbeddingProvider();
    resetEmbeddingProvider();
    const b = getEmbeddingProvider();
    expect(a).not.toBe(b);
  });

  it("exposes the configured model name", () => {
    const provider = getEmbeddingProvider();
    expect(provider.model).toBe(process.env.EMBEDDING_MODEL!);
  });

  it("exposes embed() and embedBatch() methods", () => {
    const provider = getEmbeddingProvider();
    expect(typeof provider.embed).toBe("function");
    expect(typeof provider.embedBatch).toBe("function");
  });
});

// ─── embedBatch ───────────────────────────────────────────────────────────────

describe("EmbeddingProvider.embedBatch", () => {
  it("returns an empty array for an empty input without calling the API", async () => {
    const provider = getEmbeddingProvider();
    const spy = spyOn(globalThis, "fetch");
    const result = await provider.embedBatch([]);
    expect(result).toEqual([]);
    expect(spy.mock.calls).toHaveLength(0);
    spy.mockRestore();
  });

  it("calls OpenAI's /embeddings endpoint", async () => {
    const provider = getEmbeddingProvider();
    const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockEmbeddingsResponse([[0.1, 0.2, 0.3]])
    );

    await provider.embedBatch(["hello world"]);

    expect(spy.mock.calls).toHaveLength(1);
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    spy.mockRestore();
  });

  it("sends the texts and model name in the POST body", async () => {
    const provider = getEmbeddingProvider();
    const texts = ["text one", "text two"];
    const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockEmbeddingsResponse([[0.1, 0.2], [0.3, 0.4]])
    );

    await provider.embedBatch(texts);

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.input).toEqual(texts);
    expect(body.model).toBe(process.env.EMBEDDING_MODEL!);
    spy.mockRestore();
  });

  it("sends the configured API key as a bearer token", async () => {
    const provider = getEmbeddingProvider();
    const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockEmbeddingsResponse([[0.1, 0.2]])
    );

    await provider.embedBatch(["hello"]);

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${process.env.OPENAI_API_KEY}`);
    spy.mockRestore();
  });

  it("returns vectors in input order even when API returns them out of order", async () => {
    const provider = getEmbeddingProvider();
    const vec0 = [1.0, 0.0];
    const vec1 = [0.0, 1.0];

    const outOfOrderResponse = new Response(
      JSON.stringify({
        data: [
          { object: "embedding", index: 1, embedding: vec1 },
          { object: "embedding", index: 0, embedding: vec0 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(outOfOrderResponse);
    const result = await provider.embedBatch(["first", "second"]);
    spy.mockRestore();

    expect(result[0]).toEqual(vec0);
    expect(result[1]).toEqual(vec1);
  });

  it("throws with the HTTP status code when the API returns non-200", async () => {
    const provider = getEmbeddingProvider();
    const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Service Unavailable", { status: 503 })
    );

    await expect(provider.embedBatch(["test"])).rejects.toThrow("503");
    spy.mockRestore();
  });
});

// ─── embed ────────────────────────────────────────────────────────────────────

describe("EmbeddingProvider.embed", () => {
  it("returns a single vector for a single text", async () => {
    const provider = getEmbeddingProvider();
    const mockVec = [0.5, 0.6, 0.7];

    const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockEmbeddingsResponse([mockVec])
    );
    const result = await provider.embed("some text");
    spy.mockRestore();

    expect(result).toEqual(mockVec);
  });

  it("delegates to embedBatch with a single-element array", async () => {
    const provider = getEmbeddingProvider();
    const mockVec = [0.1, 0.9];

    const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockEmbeddingsResponse([mockVec])
    );
    await provider.embed("hello");

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    spy.mockRestore();

    expect(body.input).toEqual(["hello"]);
  });
});
