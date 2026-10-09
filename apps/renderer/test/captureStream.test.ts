import { afterEach, describe, expect, it, vi } from "vitest";
import { streamCapture } from "../src/capture.js";

/** Stub fetch with a streamed text body delivered in the given chunks. */
function stubStream(chunks: string[]) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("streamCapture — __EXIT__ sentinel", () => {
  it("reads the exit code from a newline-terminated sentinel", async () => {
    stubStream(["step 1\n", "step 2\n__EXIT__:0\n"]);
    const lines: string[] = [];
    const { exitCode } = await streamCapture("/api/capture/run", (l) => lines.push(l));
    expect(exitCode).toBe(0);
    expect(lines).toEqual(["step 1", "step 2"]);
  });

  it("reads the exit code when the stream ends without a trailing newline", async () => {
    stubStream(["step 1\n__EXIT__:", "2"]);
    const lines: string[] = [];
    const { exitCode } = await streamCapture("/api/capture/run", (l) => lines.push(l));
    expect(exitCode).toBe(2);
    expect(lines).toEqual(["step 1"]);
  });

  it("still forwards a trailing partial line that is not a sentinel", async () => {
    stubStream(["step 1\npartial"]);
    const lines: string[] = [];
    const { exitCode } = await streamCapture("/api/capture/run", (l) => lines.push(l));
    expect(exitCode).toBe(-1);
    expect(lines).toEqual(["step 1", "partial"]);
  });

  it("handles a CRLF-terminated sentinel", async () => {
    stubStream(["ok\r\n__EXIT__:0\r\n"]);
    const { exitCode } = await streamCapture("/api/capture/run", () => {});
    expect(exitCode).toBe(0);
  });
});
