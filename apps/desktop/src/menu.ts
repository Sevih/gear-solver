/**
 * Application menu — a minimal File / View / Help template that replaces
 * Electron's default menu. The default one carries Reload (Ctrl+R, F5) and
 * Force reload, which reload the window and kill a running solve or plugin
 * install; this template has neither. Pure (types only from `electron`) so it
 * is testable without Electron; main.ts builds and installs it.
 */
import type { MenuItemConstructorOptions } from "electron";

export const USER_GUIDE_URL = "https://github.com/Sevih/gear-solver/wiki";
export const ISSUES_URL = "https://github.com/Sevih/gear-solver/issues";

export function appMenuTemplate(opts: {
  version: string;
  isDev: boolean;
  openExternal: (url: string) => void;
  showAbout: () => void;
}): MenuItemConstructorOptions[] {
  return [
    {
      label: "File",
      submenu: [{ label: "Quit", role: "quit" }],
    },
    {
      label: "View",
      submenu: [
        { label: "Zoom in", role: "zoomIn" },
        { label: "Zoom out", role: "zoomOut" },
        { label: "Reset zoom", role: "resetZoom" },
        { type: "separator" },
        { label: "Toggle full screen", role: "togglefullscreen" },
        { type: "separator" },
        { label: "Toggle developer tools", role: "toggleDevTools", accelerator: "F12" },
        // Hidden twin so Ctrl+Shift+I keeps working alongside F12.
        { label: "Toggle developer tools", role: "toggleDevTools", accelerator: "CmdOrCtrl+Shift+I", visible: false },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "User guide", click: () => opts.openExternal(USER_GUIDE_URL) },
        { label: "Report an issue", click: () => opts.openExternal(ISSUES_URL) },
        { type: "separator" },
        { label: `About gear-solver ${opts.version}`, click: () => opts.showAbout() },
      ],
    },
  ];
}
