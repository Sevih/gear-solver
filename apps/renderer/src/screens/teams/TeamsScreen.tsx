/**
 * Teams screen — one card per team, a team being built for one fight (a World
 * Boss, a Dimensional Singularity, a guild raid boss…) without regard for the
 * rest of the roster (`lib/teams/teams.ts`). A card holds the team's name
 * (renamable), its 1 to 4 members in order (⠿ drag, or ▲ / ▼) and, for each,
 * the build retained for them: its pieces on the game's grid (the piece card on
 * hover, as on Presets), its CP and solve mode, and a "stale" mark with its
 * reason (a piece gone from the inventory, or taken by a member placed before).
 *
 * "Optimize →" opens the Optimizer on the member in team context (their own
 * filters, any piece but the never-use ones and the earlier members' builds;
 * "Use for team" there retains a result). "+ Add hero" picks from the roster
 * (the team's heroes greyed out, 4 at most), each new member starting on the
 * blank defaults. "+ Worklist" queues one entry per member with a build that
 * isn't stale (`lib/teams/teamWorklist.ts`) and says which members it leaves
 * out. Nothing is written to the game.
 *
 * App owns the list (`gs.teams`, `lib/storage/teams.ts`) and the Optimizer's
 * team context.
 */
import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Character, GameData, GearPiece, GearSlot, Inventory } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { CharacterPortrait, SlotMini } from "../../design/EquipmentIcon.js";
import { GearCardBody } from "../../design/GearCard.js";
import { RichTooltip } from "../../design/RichTooltip.js";
import { HeroPicker } from "../../design/HeroPicker.js";
import { CyanButton } from "../../design/Shell.js";
import { cx } from "../../design/cx.js";
import { toUiPiece } from "../../design/adapter.js";
import { GAME_GEAR_GRID, toEngineSlot } from "../../design/tokens.js";
import { filterDefaults } from "../../lib/solver/builderFilters.js";
import type { ReforgeMode } from "../../lib/solver/engine.js";
import { displayNameOf } from "../../lib/heroes/heroName.js";
import { heroListOrder } from "../../lib/heroes/heroListOrder.js";
import type { HeroPriority } from "../../lib/storage/heroPriority.js";
import type { WorklistEntry } from "../../lib/storage/worklist.js";
import {
  addMember, addTeam, buildStaleness, createTeam, defaultTeamName, moveMember, removeMember, removeTeam, renameTeam, updateTeam,
  TEAM_MAX_MEMBERS, TEAM_NAME_MAX, validTeamName, type BuildStaleness, type Team, type TeamMember,
} from "../../lib/teams/teams.js";
import { teamWorklistFor, type TeamWorklist } from "../../lib/teams/teamWorklist.js";

interface TeamsScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  teams: Team[];
  onTeamsChange: Dispatch<SetStateAction<Team[]>>;
  /** App's hero ranks — order of the "+ Add hero" picker (`heroListOrder`). */
  heroPriority: HeroPriority;
  /** Settings › Solver — the blank filters a new member starts on. */
  defaultReforgeMode: ReforgeMode;
  defaultRerollPotential: boolean;
  /** Open the Optimizer on a member, in team context. */
  onOptimizeMember: (teamId: string, heroUid: string) => void;
  /** Queue a team's entries (App's batch `addToWorklist`, one toast). */
  onAddToWorklist?: (teamName: string, entries: WorklistEntry[]) => void;
}

interface HeroView {
  name: string;
  displayCharId: number;
  cls: string | null;
  element: string | null;
}

/** Engine order of `TeamBuild.pieceUids` (`SolveBuild.pieceUids`). */
const ENGINE_SLOTS: readonly GearSlot[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "exclusive", "ooparts"];

const newId = () => crypto.randomUUID();

export function TeamsScreen({ inventory, game, teams, onTeamsChange, heroPriority, defaultReforgeMode, defaultRerollPotential, onOptimizeMember, onAddToWorklist }: TeamsScreenProps) {
  const [draftName, setDraftName] = useState("");
  const pickerHeroes = useMemo(() => heroListOrder(inventory?.characters ?? [], { rank: heroPriority }), [inventory, heroPriority]);
  const heroes = useMemo(() => {
    const m = new Map<string, HeroView>();
    for (const c of inventory?.characters ?? []) {
      const { charId, def } = effectiveCharacter(c, game?.characters);
      m.set(c.uid, { name: displayNameOf(c, def), displayCharId: charId, cls: def?.cls ?? null, element: def?.element ?? null });
    }
    return m;
  }, [inventory, game]);
  const pieceByUid = useMemo(() => new Map<string, GearPiece>(inventory?.gear.map((g) => [g.uid, g]) ?? []), [inventory]);
  const present = useMemo(() => new Set(pieceByUid.keys()), [pieceByUid]);

  if (!inventory) {
    return <Empty title="No capture yet" subtitle="Install the capture plugin (Settings, top right) and play OUTERPLANE to the lobby: your roster imports by itself, then build your teams here." />;
  }

  const create = () => {
    const team = createTeam(validTeamName(draftName) ?? defaultTeamName(teams), newId(), Date.now());
    if (!team) return;
    onTeamsChange((ts) => addTeam(ts, team));
    setDraftName("");
  };
  const edit = (id: string, update: (t: Team) => Team | null) => onTeamsChange((ts) => updateTeam(ts, id, update));

  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <div className="flex flex-wrap items-center gap-3 text-[11.5px]">
        <span className="font-mono uppercase tracking-wider text-zinc-400">Teams</span>
        <span className="max-w-3xl text-zinc-400">
          One team per fight: up to 4 heroes in order, each optimized with their own filters on the whole inventory — member 1 takes anything, each next one everything but the builds of the members before. The rest of the roster, the hero ranks, the in-game presets and the Worklist play no part.
        </span>
        <form className="ml-auto flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input
            value={draftName}
            maxLength={TEAM_NAME_MAX}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={defaultTeamName(teams)}
            aria-label="New team name"
            className="h-8 w-56 rounded-md border border-white/8 bg-black/30 px-2 text-[11.5px] text-white placeholder:text-white/45 focus:border-cyan-400/40 focus:outline-none"
          />
          <CyanButton type="submit">+ New team</CyanButton>
        </form>
      </div>

      {teams.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <h2 className="font-display text-[16px] font-semibold text-white">No team yet</h2>
          <p className="max-w-md text-[12.5px] leading-relaxed text-white/60">
            Build a team for one fight (World Boss, Dimensional Singularity, guild raid…): pick its heroes, give each one the filters of that fight, optimize them in order, then send their builds to the Worklist.
          </p>
        </div>
      ) : teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          game={game}
          inventory={inventory}
          heroes={heroes}
          roster={pickerHeroes}
          pieceByUid={pieceByUid}
          present={present}
          onRename={(name) => {
            if (!validTeamName(name)) return false;
            edit(team.id, (t) => renameTeam(t, name));
            return true;
          }}
          onDelete={() => onTeamsChange((ts) => removeTeam(ts, team.id))}
          onAddMember={(uid) => edit(team.id, (t) => addMember(t, uid, filterDefaults(defaultReforgeMode, defaultRerollPotential)))}
          onRemoveMember={(uid) => edit(team.id, (t) => removeMember(t, uid))}
          onMoveMember={(uid, to) => edit(team.id, (t) => moveMember(t, uid, to))}
          onOptimize={(uid) => onOptimizeMember(team.id, uid)}
          onAddToWorklist={onAddToWorklist}
        />
      ))}
    </div>
  );
}

function TeamCard({
  team, game, inventory, heroes, roster, pieceByUid, present, onRename, onDelete, onAddMember, onRemoveMember, onMoveMember, onOptimize, onAddToWorklist,
}: {
  team: Team;
  game: GameData | null;
  inventory: Inventory;
  heroes: ReadonlyMap<string, HeroView>;
  roster: Character[];
  pieceByUid: ReadonlyMap<string, GearPiece>;
  present: ReadonlySet<string>;
  /** False when the name is refused. */
  onRename: (name: string) => boolean;
  onDelete: () => void;
  onAddMember: (heroUid: string) => void;
  onRemoveMember: (heroUid: string) => void;
  onMoveMember: (heroUid: string, to: number) => void;
  onOptimize: (heroUid: string) => void;
  onAddToWorklist?: (teamName: string, entries: WorklistEntry[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragged = useRef<string | null>(null);
  const memberUids = useMemo(() => new Set(team.members.map((m) => m.heroUid)), [team.members]);
  const full = team.members.length >= TEAM_MAX_MEMBERS;
  // What "+ Worklist" would push now — and whom it leaves out, said on the button.
  const plan = useMemo<TeamWorklist>(() => teamWorklistFor(team, inventory, game, () => "", 0), [team, inventory, game]);
  const nameOf = (uid: string) => heroes.get(uid)?.name ?? "Unknown hero";
  const skipped = [
    plan.stale.length > 0 && `${plan.stale.length} stale (${plan.stale.map(nameOf).join(", ")})`,
    plan.noBuild.length > 0 && `${plan.noBuild.length} without a build (${plan.noBuild.map(nameOf).join(", ")})`,
    plan.unchanged.length > 0 && `${plan.unchanged.length} already wearing it (${plan.unchanged.map(nameOf).join(", ")})`,
    plan.notInRoster.length > 0 && `${plan.notInRoster.length} no longer in the roster`,
  ].filter((s): s is string => !!s);
  const queue = () => {
    if (!onAddToWorklist) return;
    const fresh = teamWorklistFor(team, inventory, game, newId, Date.now());
    if (fresh.entries.length > 0) onAddToWorklist(team.name, fresh.entries);
  };
  const valid = draft != null ? validTeamName(draft) : null;
  const submitRename = () => { if (draft != null && onRename(draft)) setDraft(null); };

  return (
    // No backdrop-filter on the card: it would make it a stacking context, and
    // the HeroPicker list (z-30) would then slide under the next card.
    <section className="relative flex flex-col gap-2.5 rounded-xl border border-white/7 bg-bg-elev-2 px-3 py-2.5">
      <header className="flex flex-wrap items-center gap-2">
        {draft != null ? (
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); submitRename(); }}>
            <input
              autoFocus
              value={draft}
              maxLength={TEAM_NAME_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}
              aria-label="Team name"
              className="h-7 w-64 rounded-md border border-white/8 bg-black/30 px-1.5 text-[12px] text-white focus:border-cyan-400/40 focus:outline-none"
            />
            <button type="submit" disabled={!valid} className="inline-flex h-7 items-center rounded-md border border-cyan-400/40 bg-cyan-500/15 px-2 text-[11px] text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40">Save</button>
            <button type="button" onClick={() => setDraft(null)} className="px-1 text-[11px] text-zinc-400 hover:text-zinc-200">Cancel</button>
          </form>
        ) : (
          <>
            <span className="font-display text-[13px] font-semibold text-white">{team.name}</span>
            <button type="button" onClick={() => setDraft(team.name)} title={`Rename (${TEAM_NAME_MAX} characters max)`} className="text-[11px] text-zinc-400 hover:text-zinc-200">Rename</button>
          </>
        )}
        <span className="font-mono text-[11px] tabular-nums text-zinc-400">{`${team.members.length}/${TEAM_MAX_MEMBERS}`}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {skipped.length > 0 && <span className="text-[11px] text-zinc-400">{`Leaves out ${skipped.join(" · ")}`}</span>}
          <button
            type="button"
            onClick={queue}
            disabled={plan.entries.length === 0 || !onAddToWorklist}
            title={`Queue one Worklist entry per member with a build that isn't stale — each replaces the entry its hero already has.${skipped.length > 0 ? ` Left out: ${skipped.join(" · ")}.` : ""}`}
            className="inline-flex h-7 items-center rounded-md border border-white/8 bg-white/3 px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-white/6 disabled:cursor-not-allowed disabled:text-white/45 disabled:hover:bg-white/3"
          >{`+ Worklist${plan.entries.length > 0 ? ` (${plan.entries.length})` : ""}`}</button>
          <button
            type="button"
            onClick={() => { if (confirmDelete) onDelete(); else setConfirmDelete(true); }}
            onBlur={() => setConfirmDelete(false)}
            title={confirmDelete ? "Click again to delete this team" : "Delete this team (its members' filters and builds go with it)"}
            className={cx(
              "inline-flex h-7 items-center rounded-md border px-2 text-[11px] transition-colors",
              confirmDelete ? "border-rose-400/50 bg-rose-500/15 text-rose-200" : "border-white/8 bg-white/3 text-zinc-400 hover:text-rose-300",
            )}
          >{confirmDelete ? "Delete team?" : "Delete team"}</button>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        {team.members.length === 0 && <span className="text-[11.5px] italic text-zinc-400">No hero yet — add the heroes of this fight, in the order you want them built.</span>}
        {team.members.map((m, i) => (
          <MemberRow
            key={m.heroUid}
            member={m}
            index={i}
            count={team.members.length}
            hero={heroes.get(m.heroUid) ?? null}
            staleness={buildStaleness(team, m.heroUid, present)}
            nameOf={nameOf}
            positionOf={(uid) => team.members.findIndex((x) => x.heroUid === uid) + 1}
            game={game}
            pieceByUid={pieceByUid}
            dragOver={dragOver === i}
            onDragStart={() => { dragged.current = m.heroUid; }}
            onDragOver={() => setDragOver(i)}
            onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
            onDrop={() => {
              setDragOver(null);
              const uid = dragged.current;
              dragged.current = null;
              if (uid) onMoveMember(uid, i);
            }}
            onMove={(to) => onMoveMember(m.heroUid, to)}
            onOptimize={() => onOptimize(m.heroUid)}
            onRemove={() => onRemoveMember(m.heroUid)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-zinc-400">+ Add hero</span>
        <div className="w-56" title={full ? `A team holds ${TEAM_MAX_MEMBERS} heroes at most` : undefined}>
          {full ? (
            <div className="rounded-md border border-white/6 bg-black/20 px-2 py-1 text-[11.5px] italic text-white/45">{`Team full (${TEAM_MAX_MEMBERS} heroes)`}</div>
          ) : (
            <HeroPicker mode="single" heroes={roster} game={game} value={null} onChange={(uid) => { if (uid) onAddMember(uid); }} disabledUids={memberUids} disabledTitle="Already in this team" />
          )}
        </div>
      </div>
    </section>
  );
}

function MemberRow({
  member, index, count, hero, staleness, nameOf, positionOf, game, pieceByUid, dragOver, onDragStart, onDragOver, onDragLeave, onDrop, onMove, onOptimize, onRemove,
}: {
  member: TeamMember;
  index: number;
  count: number;
  hero: HeroView | null;
  staleness: BuildStaleness | null;
  nameOf: (uid: string) => string;
  positionOf: (uid: string) => number;
  game: GameData | null;
  pieceByUid: ReadonlyMap<string, GearPiece>;
  dragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onMove: (to: number) => void;
  onOptimize: () => void;
  onRemove: () => void;
}) {
  const build = member.build;
  const stale = staleness?.stale ?? false;
  const takenBy = new Map(staleness?.taken.map((t) => [t.pieceUid, t.byHeroUid]) ?? []);
  const missing = new Set(staleness?.missing ?? []);
  const reasons = staleness ? [
    staleness.missing.length > 0 && `${staleness.missing.length} piece${staleness.missing.length === 1 ? " is" : "s are"} no longer in your inventory`,
    ...[...new Set(staleness.taken.map((t) => t.byHeroUid))].map((by) => {
      const n = staleness.taken.filter((t) => t.byHeroUid === by).length;
      return `${n} piece${n === 1 ? "" : "s"} taken by ${nameOf(by)} (member ${positionOf(by)})`;
    }),
  ].filter((s): s is string => !!s) : [];
  const arrow = "grid h-5 w-5 place-items-center rounded border border-white/8 bg-white/3 text-[9px] text-zinc-300 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div
      className={cx(
        "relative flex flex-wrap items-center gap-3 rounded-lg border bg-black/20 px-2 py-1.5",
        dragOver ? "border-cyan-400/60" : stale ? "border-amber-400/35" : "border-white/6",
      )}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
          className="cursor-grab select-none text-[13px] text-zinc-400 hover:text-zinc-200"
          title="Drag to reorder — the members are built in this order"
          aria-hidden
        >⠿</span>
        <span className="w-4 text-center font-mono text-[12px] tabular-nums text-zinc-300">{index + 1}</span>
        <div className="flex flex-col gap-0.5">
          <button type="button" className={arrow} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label="Move up" title="Move up">▲</button>
          <button type="button" className={arrow} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label="Move down" title="Move down">▼</button>
        </div>
      </div>
      <div className="flex w-44 shrink-0 items-center gap-2">
        {hero ? <CharacterPortrait charId={hero.displayCharId} name={hero.name} cls={hero.cls} element={hero.element} size={32} /> : <div className="h-8 w-8 rounded-md border border-dashed border-white/12" />}
        <span className="truncate text-[12px] font-medium text-white">{hero?.name ?? "Not in the roster"}</span>
      </div>

      {build ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {GAME_GEAR_GRID.map((designSlot) => {
              const slot = toEngineSlot(designSlot);
              const uid = build.pieceUids[ENGINE_SLOTS.indexOf(slot)] ?? "";
              const piece = uid ? pieceByUid.get(uid) ?? null : null;
              const ui = piece ? toUiPiece(piece, game) : null;
              const tile = <SlotMini slot={designSlot} piece={ui?.iconPiece ?? null} size={36} />;
              const flag = missing.has(uid) ? "missing" : takenBy.has(uid) ? "taken" : null;
              return (
                <div
                  key={designSlot}
                  className={cx("rounded-md", flag === "missing" && "ring-1 ring-rose-400/60", flag === "taken" && "ring-1 ring-amber-400/60")}
                  title={flag === "missing" ? "No longer in your inventory" : flag === "taken" ? `Taken by ${nameOf(takenBy.get(uid)!)}` : undefined}
                >
                  {ui ? <RichTooltip placement="right" className="cursor-help" content={<GearCardBody piece={ui} game={game} effects="card" inTooltip />}>{tile}</RichTooltip> : tile}
                </div>
              );
            })}
          </div>
          <div className="flex flex-col text-[11px] leading-tight">
            <span className="font-mono tabular-nums text-white">{build.cp != null ? `${Math.round(build.cp).toLocaleString("en-US")} CP` : "CP —"}</span>
            <span className="text-zinc-400">{build.mode === "cp" ? "Solve CP" : "Solve Score"}</span>
          </div>
          {stale && (
            <span className="rounded border border-amber-400/40 bg-amber-500/12 px-1.5 py-0.5 text-[10.5px] text-amber-100" title="A stale build stays shown but isn't sent to the Worklist — Optimize → again to rebuild it">
              <b className="font-semibold uppercase tracking-wider">Stale</b>{` — ${reasons.join(" · ")}`}
            </span>
          )}
        </div>
      ) : (
        <span className="min-w-0 flex-1 text-[11.5px] italic text-zinc-400">No build yet — Optimize →, then Use for team on a result.</span>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOptimize}
          disabled={!hero}
          title="Open the Optimizer on this member, with their filters for this team"
          className="inline-flex h-7 items-center rounded-md border border-cyan-400/40 bg-cyan-500/15 px-2.5 text-[11.5px] text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >Optimize →</button>
        <button
          type="button"
          onClick={onRemove}
          title="Remove from this team (their filters and build for it go with them)"
          className="inline-flex h-7 items-center rounded-md border border-white/8 bg-white/3 px-2 text-[11px] text-zinc-400 transition-colors hover:text-rose-300"
        >Remove</button>
      </div>
    </div>
  );
}

/** Centered empty-state panel (title + subtitle), e.g. before any capture. */
function Empty({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h2 className="font-display text-[18px] font-semibold text-white">{title}</h2>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-white/60">{subtitle}</p>
    </div>
  );
}
