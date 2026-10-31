// Settings → Logs markup: the empty state and the line count, rendered
// server-side.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LogsPane } from "../src/design/settings/LogsPane.js";

const render = (lines: string[]) => renderToStaticMarkup(createElement(LogsPane, { lines, onClear: () => {} }));

describe("LogsPane", () => {
  it("says so when the journal is empty", () => {
    const html = render([]);
    expect(html).toContain("No log lines yet.");
    expect(html).toContain("Logs (0 lines)");
  });

  it("lists every line under the count", () => {
    const html = render(["[10:00:00] Manual import OK", "v  Plugin copied", "[10:00:05] Syncing game data…"]);
    expect(html).toContain("Logs (3 lines)");
    expect(html).toContain("[10:00:00] Manual import OK");
    expect(html).toContain("v  Plugin copied");
    expect(html).toContain("[10:00:05] Syncing game data…");
    expect(html).not.toContain("No log lines yet.");
  });
});
