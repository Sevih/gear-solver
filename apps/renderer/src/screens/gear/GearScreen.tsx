/**
 * Gear tab — three views under one sub-tab bar: Overview (the account read
 * that was the Home tab until 2026-11-01), Pieces (the gear grid, its filters and the
 * piece card) and Scrap (the same grid on the "Scrap candidates" filters,
 * selecting by default, the Scrap value card always shown). The view is kept
 * for the session (`gs.gear.view`); a drill request (an Overview click, the
 * Worklist's "show piece") opens Pieces, which consumes it.
 *
 * While nothing is captured, every view shows the first-capture steps.
 */
import type { CaptureStatus } from "../../capture.js";
import type { SteamStatus } from "../../steam.js";
import { cx } from "../../design/cx.js";
import { jsonOneOf, useSessionState } from "../../hooks/usePersistedState.js";
import { InventoryScreen, type InventoryScreenProps } from "../inventory/InventoryScreen.js";
import { FirstCapture } from "../FirstCapture.js";
import { OverviewView, type OverviewViewProps } from "./OverviewView.js";

export type GearView = "overview" | "pieces" | "scrap";
const GEAR_VIEWS: { id: GearView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "pieces",   label: "Pieces" },
  { id: "scrap",    label: "Scrap" },
];
const GEAR_VIEW_CODEC = jsonOneOf<GearView>(GEAR_VIEWS.map((v) => v.id));

export interface GearScreenProps extends Omit<InventoryScreenProps, "mode"> {
  capStatus: CaptureStatus | null;
  /** An Overview click: App turns it into the pending `drill`. */
  onDrill?: OverviewViewProps["onDrill"];
  /** The Steam capture plugin's last status poll, for the first-capture steps. */
  steam: SteamStatus | null;
  /** Opens Settings on Setup (the first-capture steps' link). */
  onOpenSetup: () => void;
}

/** The sub-tab bar — the Pieces sub-tabs' look (InventoryTabs' SubTabBar),
 *  without counts. */
function GearViewBar({ view, setView }: { view: GearView; setView: (v: GearView) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-white/6">
      {GEAR_VIEWS.map((v) => {
        const active = view === v.id;
        return (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={cx(
              "relative px-3 py-2 text-[12px] font-semibold transition-colors",
              active ? "text-cyan-200" : "text-white hover:text-cyan-100",
            )}
          >
            {v.label}
            {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-cyan-400" />}
          </button>
        );
      })}
    </div>
  );
}

export function GearScreen({ inventory, game, capStatus, steam, onOpenSetup, drill = null, onDrill, ...pieces }: GearScreenProps) {
  const [view, setView] = useSessionState<GearView>("gs.gear.view", "overview", GEAR_VIEW_CODEC);
  // A pending drill opens Pieces, adjusted during render so Overview or Scrap
  // never shows for a frame; Pieces then consumes the request.
  if (drill && view !== "pieces") setView("pieces");

  if (!inventory) return <FirstCapture steam={steam} onOpenSetup={onOpenSetup} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-2">
        <GearViewBar view={view} setView={setView} />
      </div>
      {view === "overview" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <OverviewView inventory={inventory} game={game} capStatus={capStatus} onDrill={onDrill} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <InventoryScreen {...pieces} inventory={inventory} game={game} mode={view} drill={view === "pieces" ? drill : null} />
        </div>
      )}
    </div>
  );
}
