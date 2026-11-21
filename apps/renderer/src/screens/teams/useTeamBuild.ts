/**
 * The "Build team" pass as App runs it (`lib/teams/buildTeam.ts`): one pass at
 * a time, held above the Teams tab so it keeps going when another tab is
 * opened; each member's outcome lands in the teams as it comes (its retained
 * build, or "no build" and the reason, shown on its line until it has a build
 * again), and a toast says how the pass ended. Cancel stops after the solve in
 * progress.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { displayNameOf } from "../../lib/heroes/heroName.js";
import { fetchReco } from "../../lib/reco/fetchReco.js";
import { recoPriorityOf } from "../../lib/reco/recoPriority.js";
import { runTeamBuild, teamBuildNotice } from "../../lib/teams/buildTeam.js";
import { clearBuild, retainBuild, setMemberFilters, updateTeam, type Team } from "../../lib/teams/teams.js";

/** The pass in progress: its team, the member being solved, and whether
 *  Cancel was clicked (it stops after that member). */
export interface TeamBuildState {
  teamId: string;
  teamName: string;
  heroUid: string | null;
  stopping: boolean;
}

interface TeamBuildInput {
  teams: Team[];
  setTeams: Dispatch<SetStateAction<Team[]>>;
  inventory: Inventory | null;
  game: GameData | null;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  excludedPieces: ReadonlySet<string>;
  topN: number;
  topK: number;
  notify: (text: string) => void;
}

export function useTeamBuild({ teams, setTeams, inventory, game, userGeasLevels, userCodexLevel, excludedPieces, topN, topK, notify }: TeamBuildInput) {
  const [pass, setPass] = useState<TeamBuildState | null>(null);
  /** teamId → heroUid → why the last pass found no build for that member. */
  const [reasons, setReasons] = useState<Record<string, Record<string, string>>>({});
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const disposeRef = useRef<(() => void) | null>(null);
  // The pass reads the inputs as they are when it starts.
  const inputs = useRef({ teams, inventory, game, userGeasLevels, userCodexLevel, excludedPieces, topN, topK, notify });
  useLayoutEffect(() => { inputs.current = { teams, inventory, game, userGeasLevels, userCodexLevel, excludedPieces, topN, topK, notify }; });

  useEffect(() => () => { stopRef.current = true; disposeRef.current?.(); }, []);

  const start = useCallback((teamId: string) => {
    const { teams, inventory, game, userGeasLevels, userCodexLevel, excludedPieces, topN, topK, notify } = inputs.current;
    const team = teams.find((t) => t.id === teamId);
    if (runningRef.current || !team || team.members.length === 0 || !inventory || !game) return;
    runningRef.current = true;
    stopRef.current = false;
    setPass({ teamId, teamName: team.name, heroUid: null, stopping: false });
    setReasons((r) => ({ ...r, [teamId]: {} }));
    const charIdOf = (uid: string) => inventory.characters.find((c) => c.uid === uid)?.charId ?? null;
    const nameOf = (uid: string) => {
      const c = inventory.characters.find((x) => x.uid === uid);
      return c ? displayNameOf(c, effectiveCharacter(c, game.characters).def) : "Unknown hero";
    };
    const run = async () => {
      // The solver (orchestrator, engine, workers) loads with the first pass,
      // as it loads with the Optimizer's screen — not in App's chunk.
      const { createTeamSolver } = await import("../../lib/teams/teamSolver.js");
      const solver = createTeamSolver({ inventory, game, userGeasLevels, userCodexLevel, topN, topK });
      disposeRef.current = solver.dispose;
      try {
        return await runTeamBuild({
          team,
          excludedPieces,
          solve: solver.solve,
          recoPriority: async (uid) => {
            const charId = charIdOf(uid);
            if (charId == null) return null;
            const r = await fetchReco(charId);
            return r.status === "ok" ? recoPriorityOf(r.reco) : null;
          },
          shouldStop: () => stopRef.current,
          now: Date.now,
          onMemberStart: (heroUid) => setPass((p) => (p && p.teamId === teamId ? { ...p, heroUid } : p)),
          onMemberDone: ({ heroUid, build, reason, filters }) => {
            setTeams((ts) => updateTeam(ts, teamId, (t) => {
              const next = filters ? setMemberFilters(t, heroUid, filters) : t;
              return build ? retainBuild(next, heroUid, build) : clearBuild(next, heroUid);
            }));
            if (reason) setReasons((r) => ({ ...r, [teamId]: { ...r[teamId], [heroUid]: reason } }));
          },
        });
      } finally {
        solver.dispose();
        disposeRef.current = null;
      }
    };
    void run().then(
      (summary) => notify(teamBuildNotice(summary, nameOf)),
      (err: unknown) => notify(`${team.name}: Build team failed — ${err instanceof Error ? err.message : String(err)}`),
    ).finally(() => {
      runningRef.current = false;
      setPass(null);
    });
  }, [setTeams]);

  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    stopRef.current = true;
    setPass((p) => (p ? { ...p, stopping: true } : p));
  }, []);

  return { pass, reasons, start, cancel };
}
