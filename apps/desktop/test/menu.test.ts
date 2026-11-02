import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { appMenuTemplate } from "../src/menu.js";

function build() {
  const openExternal = vi.fn();
  const showAbout = vi.fn();
  const menu = appMenuTemplate({ version: "9.8.7", isDev: false, openExternal, showAbout });
  return { menu, openExternal, showAbout };
}

/** Every item of the tree, submenus included. */
function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])]);
}

function submenu(menu: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const sub = menu.find((m) => m.label === label)?.submenu;
  if (!Array.isArray(sub)) throw new Error(`no ${label} submenu`);
  return sub;
}

function click(item: MenuItemConstructorOptions | undefined): void {
  (item?.click as (() => void) | undefined)?.();
}

describe("appMenuTemplate", () => {
  it("has File, View and Help, in that order", () => {
    expect(build().menu.map((m) => m.label)).toEqual(["File", "View", "Help"]);
  });

  it("keeps quit, zoom, full screen and developer tools roles", () => {
    const roles = flatten(build().menu).map((i) => i.role);
    for (const r of ["quit", "zoomIn", "zoomOut", "resetZoom", "togglefullscreen", "toggleDevTools"]) {
      expect(roles).toContain(r);
    }
  });

  it("has no reload anywhere: no reload / forceReload role, no Ctrl+R or F5", () => {
    const all = flatten(build().menu);
    for (const i of all) {
      expect(i.role).not.toBe("reload");
      expect(i.role).not.toBe("forceReload");
      if (i.accelerator) {
        expect(i.accelerator).not.toMatch(/\+R$/i);
        expect(i.accelerator).not.toBe("F5");
      }
    }
  });

  it("opens the developer tools with F12 and Ctrl+Shift+I", () => {
    const accels = flatten(build().menu).filter((i) => i.role === "toggleDevTools").map((i) => i.accelerator);
    expect(accels).toContain("F12");
    expect(accels.some((a) => a === "CmdOrCtrl+Shift+I" || a === "Ctrl+Shift+I")).toBe(true);
  });

  it("Help opens the user guide and the issue tracker", () => {
    const { menu, openExternal } = build();
    const help = submenu(menu, "Help");
    click(help.find((i) => i.label === "User guide"));
    expect(openExternal).toHaveBeenLastCalledWith("https://github.com/Sevih/gear-solver/wiki");
    click(help.find((i) => i.label === "Report an issue"));
    expect(openExternal).toHaveBeenLastCalledWith("https://github.com/Sevih/gear-solver/issues");
    expect(openExternal).toHaveBeenCalledTimes(2);
  });

  it("the About item carries the version and calls showAbout", () => {
    const { menu, showAbout } = build();
    const about = submenu(menu, "Help").find((i) => i.label?.startsWith("About"));
    expect(about?.label).toBe("About gear-solver 9.8.7");
    click(about);
    expect(showAbout).toHaveBeenCalledTimes(1);
  });
});
