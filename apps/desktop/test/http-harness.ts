/**
 * Run server.ts's `handle` behind a real loopback HTTP server so tests go
 * through Node's actual request/response objects.
 */
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Reply { status: number; body: string; headers: IncomingMessage["headers"] }

export async function withServer<T>(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  run: (call: (path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Reply>) => Promise<T>,
): Promise<T> {
  const server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const call = (path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8"), headers: res.headers }));
      });
      req.on("error", reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  try {
    return await run(call);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
