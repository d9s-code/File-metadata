import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

/** A fetch that answers only when told to, recording the order requests went out. */
function heldFetch() {
  const sent: string[] = [];
  const pending: (() => void)[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    sent.push(`${init?.method ?? "GET"} ${new URL(url, "http://x").pathname}`);
    return new Promise<Response>((resolve) => pending.push(() => resolve(new Response("{}", { status: 200 }))));
  });
  vi.stubGlobal("fetch", fetchMock);
  // The browser bits the client touches (a cookie for the CSRF token, the "data changed" event).
  vi.stubGlobal("document", { cookie: "csrf_token=t" });
  vi.stubGlobal("window", { dispatchEvent: () => true });
  vi.stubGlobal("CustomEvent", class {});
  return { sent, answerOne: () => pending.shift()?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe("requests from one tab", () => {
  it("go out at most six at a time, and a change goes before queued reads", async () => {
    const { sent, answerOne } = heldFetch();
    const reads = Array.from({ length: 10 }, (_, i) => api.get(`/r${i}`));
    await tick();
    expect(sent).toHaveLength(6);

    const write = api.patch("/modes/1", { notes: "x" });
    await tick();
    expect(sent).toHaveLength(6);

    answerOne(); // one read done: the change goes next, before r6–r9
    await tick();
    await tick();
    expect(sent[6]).toBe("PATCH /modes/1");

    for (let i = 0; i < 12; i++) {
      answerOne();
      await tick();
      await tick();
    }
    await Promise.all([...reads, write]);
    expect(sent).toHaveLength(11);
  });
});
