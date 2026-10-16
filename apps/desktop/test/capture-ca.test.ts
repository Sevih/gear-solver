import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CA_HASH_FILE, captureCaReady, ensureCaptureCa } from "../src/capture-ca.js";

// Fake mitmdump: like the real one, writes the CA into `--set confdir=<dir>`
// at startup and keeps running until killed. Each run gets a distinct cert
// (its pid) and is counted in `<bin>/runs` — FIRST: the caller kills it as
// soon as the certs are on disk, so a count written after them could be lost
// (seen on CI, 15/10).
const FAKE_MITMDUMP = `#!/bin/sh
echo $$ >> "$(dirname "$0")/runs"
dir=""
for a in "$@"; do case "$a" in confdir=*) dir="\${a#confdir=}";; esac; done
cert="-----BEGIN CERTIFICATE-----
run-$$
-----END CERTIFICATE-----"
printf '%s\\n' "-----BEGIN PRIVATE KEY-----" "key-$$" "-----END PRIVATE KEY-----" "$cert" > "$dir/mitmproxy-ca.pem"
printf '%s\\n' "$cert" > "$dir/mitmproxy-ca-cert.pem"
exec sleep 30
`;
// Exits at once without writing anything (broken / blocked binary).
const BROKEN_MITMDUMP = "#!/bin/sh\nexit 1\n";

let root: string;
let caDir: string;
const lines: string[] = [];
const log = (l: string) => { lines.push(l); };

function fake(script: string): string {
  const p = join(root, "bin", "mitmdump");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return p;
}
const runs = () => (existsSync(join(root, "bin", "runs")) ? readFileSync(join(root, "bin", "runs"), "utf-8").trim().split("\n").length : 0);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gs-ca-"));
  mkdirSync(join(root, "bin"));
  caDir = join(root, "userData", "capture-ca");
  lines.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("ensureCaptureCa", () => {
  it("generates the CA with mitmdump and copies the cert to c8750f0d.0", async () => {
    const mitmdump = fake(FAKE_MITMDUMP);
    await ensureCaptureCa(mitmdump, caDir, log);
    expect(CA_HASH_FILE).toBe("c8750f0d.0");
    expect(captureCaReady(caDir)).toBe(true);
    const cert = readFileSync(join(caDir, "mitmproxy-ca-cert.pem"), "utf-8");
    expect(readFileSync(join(caDir, CA_HASH_FILE), "utf-8")).toBe(cert);
    expect(readFileSync(join(caDir, "mitmproxy-ca.pem"), "utf-8")).toContain("PRIVATE KEY");
    expect(existsSync(`${caDir}.new`)).toBe(false);
    expect(runs()).toBe(1);
    expect(lines.at(-1)).toMatch(/certificate ready/);
  });

  it("reuses an existing CA without starting mitmdump again", async () => {
    const mitmdump = fake(FAKE_MITMDUMP);
    await ensureCaptureCa(mitmdump, caDir, log);
    const first = readFileSync(join(caDir, CA_HASH_FILE), "utf-8");
    await ensureCaptureCa(mitmdump, caDir, log);
    expect(runs()).toBe(1);
    expect(readFileSync(join(caDir, CA_HASH_FILE), "utf-8")).toBe(first);
  });

  it("restores a missing c8750f0d.0 from the existing CA instead of generating a new one", async () => {
    const mitmdump = fake(FAKE_MITMDUMP);
    await ensureCaptureCa(mitmdump, caDir, log);
    const cert = readFileSync(join(caDir, "mitmproxy-ca-cert.pem"), "utf-8");
    rmSync(join(caDir, CA_HASH_FILE));
    await ensureCaptureCa(mitmdump, caDir, log);
    expect(runs()).toBe(1);
    expect(readFileSync(join(caDir, CA_HASH_FILE), "utf-8")).toBe(cert);
  });

  it("concurrent callers share one generation", async () => {
    const mitmdump = fake(FAKE_MITMDUMP);
    await Promise.all([ensureCaptureCa(mitmdump, caDir, log), ensureCaptureCa(mitmdump, caDir, log)]);
    expect(runs()).toBe(1);
    expect(captureCaReady(caDir)).toBe(true);
  });

  it("fails cleanly when mitmdump exits without writing the CA", async () => {
    const mitmdump = fake(BROKEN_MITMDUMP);
    await expect(ensureCaptureCa(mitmdump, caDir, log)).rejects.toThrow(/exited before writing/);
    expect(existsSync(caDir)).toBe(false);
    expect(existsSync(`${caDir}.new`)).toBe(false);
  });
});
