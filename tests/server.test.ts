// @vitest-environment node
import { afterAll, beforeAll, describe, it, expect } from "vitest";
// @ts-expect-error The server is JavaScript.
import { createApp } from "../server/index.mjs";
let server: any, base: string, cookie: string;
let upstreamHeaders: Record<string, string>;
const origin = "http://127.0.0.1:5173";
beforeAll(async () => {
  server = createApp({
    upstream: async (_url: string, init: any) => {
      upstreamHeaders = init.headers;
      return Response.json({ answers: { s0: { noul: 0.95 } } });
    },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/settings`);
  cookie = response.headers.get("set-cookie")!.split(";")[0];
});
afterAll(() => server.close());
describe("Key security", () => {
  it("sets an HttpOnly session cookie", async () => {
    const r = await fetch(`${base}/api/settings`);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("set-cookie")).toContain("SameSite=Strict");
  });
  it("rejects a foreign origin", async () => {
    const r = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: {
        origin: "https://unrelated.example",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ key: "secret" }),
    });
    expect(r.status).toBe(403);
  });
  it("rejects mutations without an origin", async () => {
    const r = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ key: "secret" }),
    });
    expect(r.status).toBe(403);
  });
  it("never returns the stored key", async () => {
    const r = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { origin, "content-type": "application/json", cookie },
      body: JSON.stringify({ key: "test-secret" }),
    });
    expect(await r.json()).toEqual({ hasKey: true });
    const read = await fetch(`${base}/api/settings`, { headers: { cookie } });
    expect(await read.json()).toEqual({ hasKey: true });
  });
  it("isolates keys between sessions", async () => {
    const r = await fetch(`${base}/api/settings`);
    expect(await r.json()).toEqual({ hasKey: false });
  });
  it("sends the key only to the fixed Jev endpoint", async () => {
    const r = await fetch(`${base}/api/pass`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie },
      body: JSON.stringify({
        state: { document: "A very useful piece." },
        questions: { s0: { type: "noul", instructions: "Is this padding?" } },
      }),
    });
    expect(r.status).toBe(200);
    expect(upstreamHeaders.Authorization).toBe("Bearer test-secret");
    expect(JSON.stringify(await r.json())).not.toContain("test-secret");
  });
  it("returns a restrictive content security policy", async () => {
    const r = await fetch(`${base}/api/settings`);
    expect(r.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(r.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });
});
