/**
 * Home › System health — the capture state in the header pill's words, the
 * game data sync, and a link to Settings › Setup. The plugin install / game
 * launch buttons live in the header and in Setup only.
 */
import { captureBadge, type SteamStatus } from "../../steam.js";
import { cx } from "../../design/cx.js";
import { IC_HEALTH } from "./HomeIcons.js";
import { Card, SectionLabel, Num, ActBtn } from "./HomePrimitives.js";

export function SystemHealthCard({ steam, busy, onSyncData, onOpenSetup }: {
  steam: SteamStatus | null; busy: boolean;
  onSyncData: () => void; onOpenSetup: () => void;
}) {
  const badge = captureBadge(steam);
  const healthReady = Boolean(steam?.ready);
  return (
    <Card className="flex min-w-0 flex-[1.1] flex-col gap-3">
      <SectionLabel icon={IC_HEALTH} tint={healthReady ? "#34d399" : "#fbbf24"}>System health</SectionLabel>
      <div className="flex items-center gap-2.5" title={badge.title}>
        <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", healthReady ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-amber-400 shadow-[0_0_8px_#fbbf24]")} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-white">Capture · {badge.label}</span>
          <Num className="truncate text-[10.5px] text-zinc-400">{badge.title}</Num>
        </div>
      </div>
      <div className="mt-auto flex gap-2">
        <ActBtn className="flex-1" onClick={onSyncData} disabled={busy}>Sync game data</ActBtn>
        <ActBtn tone="cyan" className="flex-1" onClick={onOpenSetup}>Open Setup</ActBtn>
      </div>
    </Card>
  );
}
