// ESLint flat config for the whole monorepo (`npm run lint` at the root).
// typescript-eslint runs WITHOUT type information (no parserOptions.project):
// the lint stays fast and independent of the per-workspace tsconfigs — tsc
// (`npm run typecheck`) already covers the typed checks.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// React Compiler rules of the react-hooks v7 preset (refs, set-state-in-effect,
// purity, immutability…): reported as warnings only, their fixes belong to the
// renderer clean-up batches — rules-of-hooks stays an error.
const reactCompilerRulesAsWarn = Object.fromEntries(
  Object.keys(reactHooks.configs.flat.recommended.rules)
    .filter((rule) => rule !== "react-hooks/rules-of-hooks" && rule !== "react-hooks/exhaustive-deps")
    .map((rule) => [rule, "warn"]),
);

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/node_modules/**",
    "apps/desktop/release/**",
    "apps/desktop/resources/**",
    ".cache/**",
    "tools/**",
    "wiki/**",
    "data/derived/**",
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed params and rest-sibling omissions (`const { a: _a, ...rest } = x`)
      // are the codebase's way to say "deliberately unused" (13 cases, tests mostly).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },

  {
    files: ["apps/renderer/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["apps/desktop/**/*.{ts,mts,mjs}", "scripts/**/*.mjs", "data/*.mjs", "**/*.config.ts"],
    languageOptions: { globals: globals.node },
  },

  {
    files: ["apps/renderer/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...reactCompilerRulesAsWarn,
    },
  },
]);
