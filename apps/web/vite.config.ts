import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DERIVED = join(root, "data", "derived");
const CAPTURED = join(root, "tools", "capture", "out");

/** Serve derived game data and captured account JSON live from the repo dirs. */
function localData(): Plugin {
  const mounts: Record<string, string> = { "/gamedata/": DERIVED, "/captured/": CAPTURED };
  return {
    name: "gear-solver-local-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        for (const [prefix, dir] of Object.entries(mounts)) {
          if (!url.startsWith(prefix)) continue;
          const rel = decodeURIComponent(url.slice(prefix.length));
          const file = normalize(join(dir, rel));
          if (!file.startsWith(dir) || !existsSync(file)) {
            res.statusCode = 404;
            return res.end("not found");
          }
          res.setHeader("Content-Type", extname(file) === ".json" ? "application/json" : "application/octet-stream");
          return createReadStream(file).pipe(res);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localData()],
  server: { port: 5173 },
  resolve: {
    alias: {
      "@gear-solver/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
});
