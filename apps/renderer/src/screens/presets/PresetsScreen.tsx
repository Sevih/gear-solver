/**
 * Presets screen — the in-game equipment presets, read-only. One card per
 * preset: its 7 pieces (EE never part of it), the heroes currently wearing it,
 * a reference hero (whose outfit the preset is) and the heroes associated with
 * it (who wear it as-is, tuned by their own EE). For each of them the preset is
 * scored on that hero (`lib/presets/evaluate.ts`); an associated hero is
 * compared to their best known outfit and flagged past the loss threshold
 * (Settings → Solver). Each hero's line proposes the gems of their own EE that
 * score best with the outfit (`lib/presets/eeGems.ts`) and scores with them;
 * "+ Worklist" queues the outfit and those gems as the hero's entry,
 * "Optimize →" opens the Builder on the hero — on the reference hero's line,
 * "Optimize preset →" also sends the outfit's effects (required) and priority
 * substats from the outfit and outerpedia's reco (`lib/presets/optimize.ts`).
 *
 * Cards come in the in-game editor's order (`presetRows`); the class chips
 * filter them and "Sort: Class" groups them by class (`presetClasses`,
 * `arrangePresets`) — kept for the mount only, like the rest of the screen.
 *
 * Nothing is written to the game: the groups are local (`gs.presetHeroes`).
 * The priority is the Builder's of this session, else the one of the hero's
 * most recent saved build (`presetPriorityOf`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Character, GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { CharacterPortrait, SlotMini } from "../../design/EquipmentIcon.js";
import { GearDetailBody } from "../../design/GearDetail.js";
import { RichTooltip } from "../../design/RichTooltip.js";
import { Pill } from "../../design/Chips.js";
import { CyanButton } from "../../design/Shell.js";
import { cx } from "../../design/cx.js";
import { toUiPiece } from "../../design/adapter.js";
import { toDesignSlot } from "../../design/tokens.js";
import {
  arrangePresets, PRESET_SLOTS, presetClasses, presetRows, type PresetPiece, type PresetRow, type PresetSort,
} from "../../lib/presets/presetRows.js";
import { CLASSES } from "../../lib/homeStats.js";
import { bestKnownFor, evaluatePresetFor, heroBases, presetLoss, presetPriorityOf, type PresetEvalContext } from "../../lib/presets/evaluate.js";
import { bestEeGemsFor } from "../../lib/presets/eeGems.js";
import { presetWorklistFor } from "../../lib/presets/presetWorklist.js";
import { presetOptimizeNote, presetOptimizePatch } from "../../lib/presets/optimize.js";
import { fetchRecoForHero } from "../../lib/reco/fetchReco.js";
import { talismanFamilyKeys, type RecoFilterPatch } from "../../lib/reco/translateReco.js";
import { worklistGem } from "../../lib/worklist/changes.js";
import type { WorklistEntry } from "../../lib/storage/worklist.js";
import { onBackupImported } from "../../lib/storage/transfer.js";
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
  /** Heroes with a queued worklist entry — "+ Worklist" then replaces it. */
  worklistHeroUids?: ReadonlySet<string>;
  /** Queue an entry (one per hero, App's `addToWorklist` — toast included). */
  onAddToWorklist?: (entry: WorklistEntry, note?: string) => void;
  /** Open the Builder on a hero (App's `setBuilderHero` + tab switch). */
  onOptimize?: (heroUid: string) => void;
  /** Open the Builder on a preset's reference hero with filters overlaid and
   *  the status line to show ("Optimize preset →"). */
  onOptimizePreset?: (heroUid: string, patch: RecoFilterPatch, note: string) => void;
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

const CLASS_ORDER = CLASSES.map((c) => c.id);
const classLabel = (id: string): string | null => CLASSES.find((c) => c.id === id)?.label ?? null;

export function PresetsScreen({ inventory, game, userGeasLevels, userCodexLevel, lossWarnPct, worklistHeroUids, onAddToWorklist, onOptimize, onOptimizePreset }: PresetsScreenProps) {
  // Read once per mount — the screen remounts on every tab switch, so an edit
  // made in the Builder (saved build, priority) is picked up on the way back.
  const [savedBuilds] = useState(loadSavedBuilds);
  const [heroFilters] = useState(loadHeroFilters);
  const [presetHeroes, setPresetHeroes] = useState<PresetHeroesMap>(loadPresetHeroes);
  useEffect(() => { persistPresetHeroes(presetHeroes); }, [presetHeroes]);
  // A backup imported while the tab is open (Settings modal) — reload, or the
  // next edit would write the pre-import groups back.
  useEffect(() => onBackupImported(() => setPresetHeroes(loadPresetHeroes())), []);
  const [classFilter, setClassFilter] = useState<ReadonlySet<string>>(() => new Set());
  const [sort, setSort] = useState<PresetSort>("game");

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
    const bases = heroBases(inventory, game, userGeasLevels, userCodexLevel, presetPriorityOf(
      (uid) => (heroFilters[uid] ? filtersForHero(heroFilters, uid, INITIAL_FILTERS).priority : null),
      savedBuilds,
    ));
    return { inventory, game, heroes: bases, savedBuilds };
  }, [inventory, game, userGeasLevels, userCodexLevel, heroFilters, savedBuilds]);
  const cards = useMemo(() => rows.map((row) => {
    const stored = presetHeroesFor(presetHeroes, row.preset.num, roster);
    return { row, stored, classes: presetClasses(row, stored, (uid) => heroes.get(uid)?.cls ?? null) };
  }), [rows, presetHeroes, roster, heroes]);
  const shown = useMemo(() => arrangePresets(cards, classFilter, sort, CLASS_ORDER), [cards, classFilter, sort]);
  const toggleClass = (id: string) => setClassFilter((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

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
          Scores use each hero's Builder priority (else their latest saved build's) with the EE gems proposed for them; a line turns orange past a {lossWarnPct} % loss.
        </span>
        <div className="flex gap-1">
          {CLASSES.map((cl) => {
            const active = classFilter.has(cl.id);
            return (
              <button
                key={cl.id}
                type="button"
                onClick={() => toggleClass(cl.id)}
                title={cl.label}
                aria-pressed={active}
                className={cx(
                  "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                  active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/7 bg-black/25 opacity-55 hover:opacity-100",
                )}
              >
                <ClassIcon label={cl.label} />
              </button>
            );
          })}
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span className="font-mono uppercase tracking-wider text-zinc-400">Sort</span>
          <div role="radiogroup" aria-label="Sort presets" className="inline-flex h-7 items-center rounded-md border border-white/7 bg-black/30 p-0.5">
            {([["game", "In-game", "The order of the in-game preset editor — favorites first"], ["class", "Class", "Grouped by class, in the in-game order within a class"]] as const).map(([id, label, title]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={sort === id}
                onClick={() => setSort(id)}
                title={title}
                className={cx(
                  "inline-flex h-6 items-center rounded px-2 text-[11px] transition-colors",
                  sort === id ? "bg-cyan-500/15 text-cyan-300" : "text-zinc-400 hover:text-zinc-200",
                )}
              >{label}</button>
            ))}
          </div>
        </div>
        {classFilter.size > 0 && (
          <button type="button" onClick={() => setClassFilter(new Set())} className="text-[11px] text-cyan-300 hover:text-cyan-200">Clear</button>
        )}
        <div className="ml-auto">
          <Pill tone="emerald">
            {rows.filter((r) => !r.empty).length} used · {rows.length} total{shown.length < rows.length ? ` · ${shown.length} shown` : ""}
          </Pill>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pb-6 pt-3">
        {shown.length === 0 && <span className="text-[11.5px] italic text-zinc-400">No preset of the selected classes.</span>}
        {shown.map(({ row, stored, classes }) => (
          <PresetCard
            key={row.preset.num}
            row={row}
            classes={classes}
            game={game}
            ctx={ctx}
            heroes={heroes}
            roster={inventory.characters}
            stored={stored}
            lossWarnPct={lossWarnPct}
            worklist={{ heroUids: worklistHeroUids, onAdd: onAddToWorklist }}
            onOptimize={onOptimize}
            onOptimizePreset={onOptimizePreset}
            onSetReference={(uid) => setPresetHeroes((m) => setPresetReference(m, row.preset.num, uid))}
            onAddAssociated={(uid) => setPresetHeroes((m) => addPresetAssociated(m, row.preset.num, uid))}
            onRemoveAssociated={(uid) => setPresetHeroes((m) => removePresetAssociated(m, row.preset.num, uid))}
          />
        ))}
      </div>
    </div>
  );
}

/** What a hero line needs to queue its entry. */
interface WorklistHook {
  heroUids?: ReadonlySet<string>;
  onAdd?: (entry: WorklistEntry, note?: string) => void;
}

function PresetCard({
  row, classes, game, ctx, heroes, roster, stored, lossWarnPct, worklist, onOptimize, onOptimizePreset, onSetReference, onAddAssociated, onRemoveAssociated,
}: {
  row: PresetRow;
  /** Raw `CCT_*` ids (`presetClasses`), empty when unknown. */
  classes: readonly string[];
  game: GameData | null;
  ctx: PresetEvalContext;
  heroes: ReadonlyMap<string, HeroView>;
  roster: Character[];
  stored: { referenceUid: string | null; associatedUids: string[] };
  lossWarnPct: number;
  worklist: WorklistHook;
  onOptimize?: (heroUid: string) => void;
  onOptimizePreset?: (heroUid: string, patch: RecoFilterPatch, note: string) => void;
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
    // No backdrop-filter on the card: it would make it a stacking context, and
    // the HeroSelect list (z-30) would then slide under the next card.
    <section className="flex flex-col gap-2.5 rounded-xl border border-white/7 bg-bg-elev-2 px-3 py-2.5">
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span className={cx("inline-block text-[9px] text-zinc-400 transition-transform", open && "rotate-90")}>▸</span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">#{preset.num}</span>
          {classes.map((id) => {
            const label = classLabel(id);
            return label ? <ClassIcon key={id} label={label} /> : null;
          })}
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
            {referenceUid && <HeroLine uid={referenceUid} row={row} ctx={ctx} heroes={heroes} lossWarnPct={lossWarnPct} worklist={worklist} onOptimize={onOptimize} onOptimizePreset={onOptimizePreset} reference />}
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
              <HeroLine key={uid} uid={uid} row={row} ctx={ctx} heroes={heroes} lossWarnPct={lossWarnPct} worklist={worklist} onOptimize={onOptimize} onRemove={() => onRemoveAssociated(uid)} />
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

/** One hero of the preset — the EE gems proposed for them, the preset's score
 *  (with those gems) and offensive ratings on them; for an associated hero,
 *  the loss against their best known outfit; "+ Worklist" for both, then
 *  "Optimize preset →" for the reference hero, "Optimize →" for the others. */
function HeroLine({
  uid, row, ctx, heroes, lossWarnPct, worklist, onOptimize, onOptimizePreset, reference = false, onRemove,
}: {
  uid: string;
  row: PresetRow;
  ctx: PresetEvalContext;
  heroes: ReadonlyMap<string, HeroView>;
  lossWarnPct: number;
  worklist: WorklistHook;
  onOptimize?: (heroUid: string) => void;
  onOptimizePreset?: (heroUid: string, patch: RecoFilterPatch, note: string) => void;
  reference?: boolean;
  onRemove?: () => void;
}) {
  const h = heroes.get(uid);
  const eeGems = useMemo(() => bestEeGemsFor(uid, row.presentPieces, ctx), [uid, row, ctx]);
  const evalPreset = useMemo(() => evaluatePresetFor(uid, row.presentPieces, ctx, eeGems?.ee), [uid, row, ctx, eeGems]);
  const asSocketed = useMemo(() => (eeGems ? evaluatePresetFor(uid, row.presentPieces, ctx) : null), [uid, row, ctx, eeGems]);
  const best = useMemo(() => (reference ? null : bestKnownFor(uid, ctx)), [uid, ctx, reference]);
  const queued = useMemo(() => presetWorklistFor(uid, row, eeGems, ctx.inventory, ctx.game), [uid, row, eeGems, ctx]);
  // The line's hero while it is mounted — a reco answering after the
  // reference changed or the card went away is dropped.
  const liveUid = useRef<string | null>(uid);
  useEffect(() => {
    liveUid.current = uid;
    return () => { liveUid.current = null; };
  }, [uid]);
  const [optimizing, setOptimizing] = useState(false);
  if (!h) return null;
  const canOptimizePreset = reference && !!onOptimizePreset && !!ctx.game;
  const optimizePreset = async () => {
    const game = ctx.game;
    if (!onOptimizePreset || !game) return;
    setOptimizing(true);
    const r = await fetchRecoForHero(uid, h.char.charId, () => liveUid.current);
    setOptimizing(false);
    if (r === null) return;
    const result = presetOptimizePatch({
      pieces: row.presentPieces,
      reco: r.status === "ok" ? r.reco : null,
      game,
      talismanFamily: talismanFamilyKeys(game.equipment),
    });
    onOptimizePreset(uid, result.patch, presetOptimizeNote(row.preset, result));
  };
  const fromSaved = ctx.heroes.get(uid)?.prioritySource === "saved";
  const gemNames = eeGems?.ee.filter((id) => id).map((id) => worklistGem(id, ctx.game).name) ?? [];
  const socketedScore = asSocketed?.score != null && fmtNum(asSocketed.score) !== fmtNum(evalPreset?.score) ? fmtNum(asSocketed.score) : null;
  const replaces = worklist.heroUids?.has(uid) ?? false;
  const addToWorklist = () => {
    if (!worklist.onAdd || queued.changes.length === 0) return;
    worklist.onAdd({
      id: crypto.randomUUID(),
      heroUid: uid,
      heroName: h.name,
      charId: h.displayCharId,
      mode: "preset",
      cp: null,
      upg: queued.upg,
      changes: queued.changes,
      createdAt: Date.now(),
    }, queued.missing > 0 ? `${queued.missing} preset piece${queued.missing === 1 ? "" : "s"} not in your inventory, left out` : undefined);
  };
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
          {socketedScore && <span className="font-mono text-[10.5px] tabular-nums text-zinc-400" title="Score with the EE gems as socketed today">({socketedScore} as socketed)</span>}
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
          {fromSaved && <span className="text-[10.5px] italic text-zinc-400" title="Not opened in the Builder this session — scored with the priority their most recent saved build was solved with">priority from saved build</span>}
        </>
      )}
      {worklist.onAdd && (
        <button
          type="button"
          onClick={addToWorklist}
          disabled={queued.changes.length === 0}
          title={queued.changes.length === 0
            ? `${h.name} already wears this preset with these EE gems`
            : replaces ? `Replace ${h.name}'s worklist entry with this preset` : `Queue this preset and the EE gems for ${h.name}`}
          className="ml-auto rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >+ Worklist</button>
      )}
      {canOptimizePreset ? (
        <CyanButton size="sm" className={cx(!worklist.onAdd && "ml-auto")} disabled={optimizing} onClick={() => void optimizePreset()}>
          {optimizing ? "Fetching…" : "Optimize preset →"}
        </CyanButton>
      ) : onOptimize && (
        <CyanButton size="sm" className={cx(!worklist.onAdd && "ml-auto")} onClick={() => onOptimize(uid)}>Optimize →</CyanButton>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={`Remove ${h.name} from this preset`}
          className={cx("grid h-6 w-6 place-items-center rounded-md border border-white/7 bg-black/40 text-[11px] text-white hover:bg-black/60", !worklist.onAdd && !onOptimize && !canOptimizePreset && "ml-auto")}
        >✕</button>
      )}
      {evalPreset && gemNames.length > 0 && (
        <span className="basis-full pl-10 text-[11px] text-zinc-300" title="The gems of their own EE that score best with this outfit — the Talisman's stay as they are (part of the preset)">
          <span className="text-[9px] uppercase tracking-wider text-zinc-400">EE gems:</span> {gemNames.join(", ")}
        </span>
      )}
    </div>
  );
}

/** Same class icon as the Builds tab's chips. */
function ClassIcon({ label }: { label: string }) {
  return (
    <img
      src={`/img/ui/class/IG_Turn_Class_${label}.webp`}
      alt={label}
      title={label}
      className="h-4 w-4 object-contain"
      loading="lazy"
      draggable={false}
    />
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
