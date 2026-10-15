/**
 * Per-install mitmproxy CA for the emulator capture, generated on the user's
 * machine before the first capture and reused afterwards. The installer ships
 * no CA: each install gets its own.
 *
 * mitmdump creates the CA itself: started with `--set confdir=<dir>`, it
 * writes `mitmproxy-ca.pem` (key + cert) and `mitmproxy-ca-cert.pem` during
 * startup, before binding the proxy port — we wait for both, stop it, and copy
 * the cert to the Android system-store name `c8750f0d.0`. mitmproxy's CA
 * subject is fixed (`O=mitmproxy CN=mitmproxy`), so its `subject_hash_old` is
 * too; users have no OpenSSL, hence the constant.
 *
 * Generation runs in a sibling `<dir>.new` staging folder renamed into place
 * once complete, so an interrupted run never leaves a half-written CA behind
 * to be reused. capture.ps1 then pushes `c8750f0d.0` to the device whenever
 * the copy there differs (an older CA gets replaced).
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { dlog, dwarn } from "./log.js";

/** Android `subject_hash_old` file name of mitmproxy's CA (fixed subject). */
export const CA_HASH_FILE = "c8750f0d.0";
const CA_KEY = "mitmproxy-ca.pem";
const CA_CERT = "mitmproxy-ca-cert.pem";

const PEM_END = "-----END CERTIFICATE-----";

/** True once `dir` holds the key, the cert and the Android-named copy. */
export function captureCaReady(dir: string): boolean {
  return [CA_KEY, CA_CERT, CA_HASH_FILE].every((f) => existsSync(join(dir, f)));
}

/** Both PEMs written to the end (existence alone could catch a partial write). */
function pemsWritten(dir: string): boolean {
  return [CA_KEY, CA_CERT].every((f) => {
    const p = join(dir, f);
    return existsSync(p) && readFileSync(p, "utf-8").includes(PEM_END);
  });
}

/** Make sure `dir` holds this install's CA, generating it with `mitmdump` the
 *  first time. Concurrent callers share the same in-flight generation. An
 *  existing CA is always kept (only the `.0` copy is restored if missing). */
let inflight: Promise<void> | null = null;
export function ensureCaptureCa(mitmdump: string, dir: string, log: (line: string) => void, timeoutMs = 30_000): Promise<void> {
  if (captureCaReady(dir)) return Promise.resolve();
  if (pemsWritten(dir)) {
    copyFileSync(join(dir, CA_CERT), join(dir, CA_HASH_FILE));
    return Promise.resolve();
  }
  if (!inflight) {
    inflight = generate(mitmdump, dir, log, timeoutMs).finally(() => { inflight = null; });
  }
  return inflight;
}

async function generate(mitmdump: string, dir: string, log: (line: string) => void, timeoutMs: number): Promise<void> {
  const stage = `${dir}.new`;
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  log(">  First capture on this machine — generating this install's capture certificate...");
  dlog("capture", `generating CA with ${mitmdump} in ${stage}`);
  const proc = spawn(mitmdump, [
    "--set", `confdir=${stage}`,
    "--listen-host", "127.0.0.1",
    "--listen-port", "0",
  ], { stdio: "ignore", windowsHide: true });
  let exited = false;
  let spawnError: Error | null = null;
  const done = new Promise<void>((resolve) => {
    proc.once("error", (err) => { spawnError = err; exited = true; resolve(); });
    proc.once("close", () => { exited = true; resolve(); });
  });

  try {
    const deadline = Date.now() + timeoutMs;
    while (!pemsWritten(stage)) {
      if (spawnError) throw new Error(`could not start mitmdump: ${(spawnError as Error).message}`);
      if (exited) throw new Error("mitmdump exited before writing the capture certificate");
      if (Date.now() > deadline) throw new Error(`mitmdump did not write the capture certificate within ${Math.round(timeoutMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (err) {
    dwarn("capture", "CA generation failed:", (err as Error).message);
    if (!exited) proc.kill();
    await done;
    rmSync(stage, { recursive: true, force: true });
    throw err;
  }
  // Wait for the process to be gone before moving the folder (Windows keeps
  // files of a running process locked).
  if (!exited) proc.kill();
  await done;

  copyFileSync(join(stage, CA_CERT), join(stage, CA_HASH_FILE));
  mkdirSync(dirname(dir), { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  renameSync(stage, dir);
  dlog("capture", `CA ready at ${dir}`);
  log("v  Capture certificate ready.");
}
