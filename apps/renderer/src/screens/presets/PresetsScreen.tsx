/**
 * Presets screen — the in-game equipment presets, read-only. One card per
 * preset: its 7 pieces (EE never part of it), the heroes currently wearing it,
 * a reference hero (whose outfit the preset is) and the heroes associated with
 * it (who wear it as-is, tuned by their own EE). For each of them the preset is
 * scored on that hero (`lib/presets/evaluate.ts`); an associated hero is
 * compared to their best known outfit and flagged past the loss threshold
 * (Settings → Solver).
 *
 * Nothing is written to the game and nothing is queued: the groups are local
 * (`gs.presetHeroes`), the optimisation (EE gems per hero, Worklist lines)
 * comes later.
 */
import { useEffect, useMemo, useState } from "react";
import type { Character, GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { CharacterPortrait, SlotMini } from "../../design/EquipmentIcon.js";
import { GearDetailBody } from "../../design/GearDetail.js";
import { RichTooltip } from "../../design/RichTooltip.js";
import { Pill } from "../../design/Chips.js";
import { cx } from "../../design/cx.js";
import { toUiPiece } from "../../design/adapter.js";
import { toDesignSlot } from "../../design/tokens.js";
import { PRESET_SLOTS, presetRows, type PresetPiece, type PresetRow } from "../../lib/presets/presetRows.js";
import { bestKnownFor, evaluatePresetFor, heroBases, presetLoss, type PresetEvalContext } from "../../lib/presets/evaluate.js";
import {
  addPresetAssociated, loadPresetHeroes, persistPresetHeroes, presetHeroesFor, removePresetAssociated, setPresetReference,
  type PresetHeroesMap,
} from "../../lib/storage/presetHeroes.js";
import { loadSavedBuilds } from "../../lib/storage/savedBuilds.js";
import { filtersForHero, loadHeroFilters } from "../../lib/storage/heroFilters.js";
import { INITIAL_FILTERS } from "../../lib/solver/builderFilters.js";
import { HeroSelect } from "../builder/HeroSelect.js";
import { displayNameOf } from "../builder/heroName.js";

interface PresetsScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  /** Loss (percent) past which an associated hero's line turns orange. */
  lossWarnPct: number;
}

/** Same rounding as the Builder's results table. */
function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 10) / 10);
}

interface HeroView {
  char: Character;
  name: string;
  displayCharId: number;
  cls: string | null;
  element: string | null;
}

export function PresetsScreen({ inventory, game, userGeasLevels, userCodexLevel, lossWarnPct }: PresetsScreenProps) {
  // Read once per mount — the screen remounts on every tab switch, so an edit
  // made in the Builder (saved build, priority) is picked up on the way back.
  const [savedBuilds] = useState(loadSavedBuilds);
  const [heroFilters] = useState(loadHeroFilters);
  const [presetHeroes, setPresetHeroes] = useState<PresetHeroesMap>(loadPresetHeroes);
  useEffect(() => { persistPresetHeroes(presetHeroes); }, [presetHeroes]);

  const rows = useMemo(() => (inventory ? presetRows(inventory) : []), [inventory]);
  const roster = useMemo(() => new Set(inventory?.characters.map((c) => c.uid) ?? []), [inventory]);
  const heroes = useMemo(() => {
    const m = new Map<string, HeroView>();
    for (const c of inventory?.characters ?? []) {
      const { charId, def } = effectiveCharacter(c, game?.characters);
      m.set(c.uid, { char: c, name: displayNameOf(c, def), displayCharId: charId, cls: def?.cls ?? null, element: def?.element ?? null });
    }
    return m;
  }, [inventory, game]);
  const ctx = useMemo<PresetEvalContext | null>(() => {
    if (!inventory) return null;
    const bases = heroBases(inventory, game, userGeasLevels, userCodexLevel,
      (uid) => (heroFilters[uid] ? filtersForHero(heroFilters, uid, INITIAL_FILTERS).priority : null));
    return { inventory, game, heroes: bases, savedBuilds };
  }, [inventory, game, userGeasLevels, userCodexLevel, heroFilters, savedBuilds]);

  if (!inventory || !ctx) {
    return <Empty title="No capture yet" subtitle="Arm capture and import your account to see your equipment presets here." />;
  }
  if (rows.length === 0) {
    return <Empty title="No presets" subtitle="This capture holds no equipment preset. Save one in-game, then reload." />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-6 pt-4 text-[11.5px]">
        <span className="font-mono uppercase tracking-wider text-zinc-400">Presets</span>
        <span className="text-zinc-400">
          A preset is one reference hero's outfit, worn as-is by its associated heroes (each keeps their own EE).
          Scores use each hero's Builder priority; a line turns orange past a {lossWarnPct} % loss.
        </span>
        <div className="ml-auto">
          <Pill tone="emerald">{rows.filter((r) => !r.empty).length} used · {rows.length} total</Pill>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pb-6 pt-3">
        {rows.map((row) => (
          <PresetCard
            key={row.preset.num}
            row={row}
            game={game}
            ctx={ctx}
            heroes={heroes}
            roster={inventory.characters}
            stored={presetHeroesFor(presetHeroes, row.preset.num, roster)}
            lossWarnPct={lossWarnPct}
            onSetReference={(uid) => setPresetHeroes((m) => setPresetReference(m, row.preset.num, uid))}
            onAddAssociated={(uid) => setPresetHeroes((m) => addPresetAssociated(m, row.preset.num, uid))}
            onRemoveAssociated={(uid) => setPresetHeroes((m) => removePresetAssociated(m, row.preset.num, uid))}
          />
        ))}
      </div>
    </div>
  );
}

function PresetCard({
  row, game, ctx, heroes, roster, stored, lossWarnPct, onSetReference, onAddAssociated, onRemoveAssociated,
}: {
  row: PresetRow;
  game: GameData | null;
  ctx: PresetEvalContext;
  heroes: ReadonlyMap<string, HeroView>;
  roster: Character[];
  stored: { referenceUid: string | null; associatedUids: string[] };
  lossWarnPct: number;
  onSetReference: (uid: string | null) => void;
  onAddAssociated: (uid: string) => void;
  onRemoveAssociated: (uid: string) => void;
}) {
  const { preset, pieces, wearerUids } = row;
  const [open, setOpen] = useState(!row.empty);
  // A unique current wearer is proposed as the reference until one is picked.
  const suggested = stored.referenceUid == null && wearerUids.length === 1 ? wearerUids[0]! : null;
  const referenceUid = stored.referenceUid ?? suggested;
  const associatedUids = stored.associatedUids.filter((u) => u !== referenceUid);
  const candidates = roster.filter((c) => c.uid !== referenceUid && !associatedUids.includes(c.uid));
  const sharedWith = [...new Map(pieces.flatMap((p) => p.sharedWith).map((r) => [r.num, r])).values()];

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-white/7 bg-bg-elev-2 px-3 py-2.5 backdrop-blur-sm">
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span className={cx("inline-block text-[9px] text-zinc-400 transition-transform", open && "rotate-90")}>▸</span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">#{preset.num}</span>
          <span className="font-display text-[13px] font-semibold text-white">{preset.name || "Unnamed preset"}</span>
          {preset.favorite && <span className="text-[12px] text-amber-300" title="Favorite in-game">★</span>}
        </button>
        {row.empty && <span className="text-[11px] italic text-zinc-400">Empty preset</span>}
        {wearerUids.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Worn by</span>
            {wearerUids.map((uid) => {
              const h = heroes.get(uid);
              return h ? <CharacterPortrait key={uid} charId={h.displayCharId} name={h.name} cls={h.cls} element={h.element} size={28} /> : null;
            })}
          </div>
        )}
      </header>

      {open && (
        <>
          {(row.missingCount > 0 || sharedWith.length > 0) && (
            <div className="flex flex-col gap-1 rounded-md border border-amber-400/30 bg-amber-500/8 px-2 py-1 text-[11px] text-amber-100">
              {row.missingCount > 0 && (
                <span>{row.missingCount} piece{row.missingCount === 1 ? " is" : "s are"} no longer in your inventory — scores use the remaining pieces.</span>
              )}
              {sharedWith.length > 0 && (
                <span>
                  {row.sharedCount} piece{row.sharedCount === 1 ? "" : "s"} shared with {sharedWith.map((r) => `#${r.num} ${r.name}`).join(", ")} — two presets can't be worn at once.
                </span>
              )}
            </div>
          )}

          <PresetPieces pieces={pieces} game={game} />

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-[10px] uppercase tracking-wider text-zinc-400">Reference</span>
              <div className="w-56">
                <HeroSelect heroes={roster} game={game} value={referenceUid} onChange={onSetReference} />
              </div>
              {suggested && <span className="text-[10.5px] italic text-zinc-400">current wearer</span>}
              {stored.referenceUid && (
                <button type="button" onClick={() => onSetReference(null)} className="text-[11px] text-cyan-300 hover:text-cyan-200">Clear</button>
              )}
            </div>
            {referenceUid && <HeroLine uid={referenceUid} row={row} ctx={ctx} heroes={heroes} lossWarnPct={lossWarnPct} reference />}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-[10px] uppercase tracking-wider text-zinc-400">Associated</span>
              <div className="w-56">
                <HeroSelect heroes={candidates} game={game} value={null} onChange={(uid) => { if (uid) onAddAssociated(uid); }} />
              </div>
              {associatedUids.length === 0 && <span className="text-[10.5px] italic text-zinc-400">Add the heroes who will share this outfit</span>}
            </div>
            {associatedUids.map((uid) => (
              <HeroLine key={uid} uid={uid} row={row} ctx={ctx} heroes={heroes} lossWarnPct={lossWarnPct} onRemove={() => onRemoveAssociated(uid)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** The 7 preset slots, the existing tile + hover detail per piece, flagged
 *  when missing from the inventory or shared with another preset. */
function PresetPieces({ pieces, game }: { pieces: PresetPiece[]; game: GameData | null }) {
  const bySlot = new Map(pieces.filter((p) => p.slot).map((p) => [p.slot!, p]));
  const unknown = pieces.filter((p) => !p.slot);
  const cells: Array<{ key: string; slot: string; p: PresetPiece | null }> = [
    ...PRESET_SLOTS.map((s) => ({ key: s, slot: toDesignSlot(s) ?? s, p: bySlot.get(s) ?? null })),
    ...unknown.map((p) => ({ key: p.uid, slot: "weapon", p })),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {cells.map(({ key, slot, p }) => {
        const ui = p?.piece ? toUiPiece(p.piece, game) : null;
        const set = p?.piece?.armorSetId ? game?.sets[p.piece.armorSetId]?.name ?? null : null;
        const tile = <SlotMini slot={slot} piece={ui?.iconPiece ?? null} size={55} />;
        return (
          <div key={key} className="flex w-16 flex-col items-center gap-0.5">
            <div className={cx("relative rounded-lg", p?.missing && "ring-1 ring-rose-400/60", p && p.sharedWith.length > 0 && "ring-1 ring-amber-400/60")}>
              {ui ? <RichTooltip placement="right" className="cursor-help" content={<GearDetailBody piece={ui} game={game} inTooltip />}>{tile}</RichTooltip> : tile}
              {p?.missing && <Badge tone="rose" title="This piece is no longer in your inventory">missing</Badge>}
              {p && !p.missing && p.sharedWith.length > 0 && (
                <Badge tone="amber" title={`Shared with ${p.sharedWith.map((r) => `#${r.num} ${r.name}`).join(", ")}`}>shared</Badge>
              )}
            </div>
            {ui?.main[0] && <span className="max-w-16 truncate text-[10px] text-white/80" title={ui.main.map((m) => m.label).join(" · ")}>{ui.main[0].label}</span>}
            {set && <span className="max-w-16 truncate text-[9.5px] text-zinc-400" title={set}>{set}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Badge({ tone, title, children }: { tone: "rose" | "amber"; title: string; children: string }) {
  return (
    <span
      title={title}
      className={cx(
        "pointer-events-none absolute -top-1.5 left-1/2 -translate-x-1/2 rounded px-1 text-[8.5px] font-semibold uppercase tracking-wider",
        tone === "rose" ? "bg-rose-500/90 text-white" : "bg-amber-500/90 text-black",
      )}
    >{children}</span>
  );
}

/** One hero of the preset — the preset's score and offensive ratings on them;
 *  for an associated hero, the loss against their best known outfit. */
function HeroLine({
  uid, row, ctx, heroes, lossWarnPct, reference = false, onRemove,
}: {
  uid: string;
  row: PresetRow;
  ctx: PresetEvalContext;
  heroes: ReadonlyMap<string, HeroView>;
  lossWarnPct: number;
  reference?: boolean;
  onRemove?: () => void;
}) {
  const h = heroes.get(uid);
  const evalPreset = useMemo(() => evaluatePresetFor(uid, row.presentPieces, ctx), [uid, row, ctx]);
  const best = useMemo(() => (reference ? null : bestKnownFor(uid, ctx)), [uid, ctx, reference]);
  if (!h) return null;
  const loss = best ? presetLoss(evalPreset?.score ?? null, best.score) : null;
  const lossPct = loss != null ? Math.round(loss * 100) : null;
  const warn = lossPct != null && lossPct > lossWarnPct;
  const vs = best?.source === "saved" ? "saved build" : "current gear";
  return (
    <div className={cx(
      "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-2 py-1.5",
      warn ? "border-orange-400/50 bg-orange-500/10" : "border-white/6 bg-black/20",
    )}>
      <div className="flex w-56 items-center gap-2">
        <CharacterPortrait charId={h.displayCharId} name={h.name} cls={h.cls} element={h.element} size={32} />
        <span className="truncate text-[12px] text-white">{h.name}</span>
      </div>
      {!evalPreset ? (
        <span className="text-[11px] italic text-zinc-400">Stats unavailable for this hero (missing game data).</span>
      ) : (
        <>
          <Metric label="Score" value={evalPreset.score == null ? "—" : fmtNum(evalPreset.score)} />
          <Metric label="Dmg" value={fmtNum(evalPreset.ratings.dmg)} />
          <Metric label="DmgS" value={fmtNum(evalPreset.ratings.dmgs)} />
          {evalPreset.score == null ? (
            <span className="text-[11px] text-zinc-300">no priority set for {h.name} — set one in the Builder</span>
          ) : !reference && (
            lossPct == null ? (
              <span className="text-[11px] text-zinc-400">no score to compare against</span>
            ) : warn ? (
              <span className="text-[11.5px] font-medium text-orange-200">{h.name} loses {lossPct} % vs their {vs}</span>
            ) : (
              <span className="font-mono text-[11px] tabular-nums text-zinc-300" title={`Best known: score ${fmtNum(best?.score)} (${vs})`}>
                {lossPct > 0 ? `−${lossPct}` : `+${-lossPct}`} % vs {vs}
              </span>
            )
          )}
        </>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={`Remove ${h.name} from this preset`}
          className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-white/7 bg-black/40 text-[11px] text-white hover:bg-black/60"
        >✕</button>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 font-mono text-[11.5px] tabular-nums">
      <span className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</span>
      <span className="text-white">{value}</span>
    </span>
  );
}

function Empty({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h2 className="font-display text-[18px] font-semibold text-zinc-100">{title}</h2>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-zinc-400">{subtitle}</p>
    </div>
  );
}
