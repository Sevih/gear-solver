import { useEffect, useState } from "react";
import type { GameData, Inventory, RawUserItem, RawUserCharacter, RolledStat } from "@gear-solver/core";
import { autoImport, parseFiles } from "./data.js";

const STAT_LABEL: Record<string, string> = {
  atk: "ATK", atkPct: "ATK%", hp: "HP", hpPct: "HP%", def: "DEF", defPct: "DEF%",
  critRate: "Crit", critDmg: "C.DMG", spd: "SPD", eff: "EFF", effRes: "RES",
  dmgUp: "DMG+", dmgReduce: "DMG-", pen: "PEN", critDmgReduce: "CDR", hitAp: "HitAP", killAp: "KillAP",
};

function fmt(s: RolledStat): string {
  const v = s.percent ? `${s.value}%` : `${s.value}`;
  return `${STAT_LABEL[s.stat] ?? s.stat} ${v}`;
}

export function App() {
  const [game, setGame] = useState<GameData | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [status, setStatus] = useState("Chargement…");

  useEffect(() => {
    autoImport().then((r) => {
      setGame(r.game);
      setInv(r.inventory);
      if (r.inventory) setStatus(`Auto-import OK (${r.game ? "stats résolues" : "sans data jeu"})`);
      else setStatus(r.game ? "Données jeu chargées — aucune capture trouvée dans tools/capture/out/." : "Aucune donnée. Lance capture.ps1 puis recharge.");
    });
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    let userItem: RawUserItem | null = null;
    let userChar: RawUserCharacter | undefined;
    for (const f of Array.from(files)) {
      const j = JSON.parse(await f.text());
      if (j.ItemList) userItem = j as RawUserItem;
      else if (j.CharList) userChar = j as RawUserCharacter;
    }
    if (userItem) {
      setInv(parseFiles(game, userItem, userChar));
      setStatus("Import manuel OK");
    }
  }

  const equipped = inv?.gear.filter((g) => g.equippedBy).length ?? 0;

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 1000, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Outerplane Gear Solver</h1>
      <p style={{ color: "#666" }}>{status}</p>

      {!inv && (
        <p>
          Fallback manuel :{" "}
          <input type="file" accept="application/json" multiple onChange={(e) => onFiles(e.target.files)} />
        </p>
      )}

      {inv && (
        <section>
          <ul>
            <li>{inv.gear.length} pièces ({equipped} équipées, {inv.gear.length - equipped} libres)</li>
            <li>{inv.characters.length} personnages</li>
          </ul>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
                <th>Nom</th><th>Slot</th><th>Rareté</th><th>Brk</th><th>Main</th><th>Substats</th>
              </tr>
            </thead>
            <tbody>
              {inv.gear.slice(0, 60).map((g) => (
                <tr key={g.uid} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{g.name ?? `#${g.itemId}`}</td>
                  <td>{g.slot}</td>
                  <td>{g.rarity}</td>
                  <td>T{g.breakthrough}</td>
                  <td>{g.main.map(fmt).join(" / ")}</td>
                  <td>{g.subs.map(fmt).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: "#999" }}>Aperçu des 60 premières pièces.</p>
        </section>
      )}
    </main>
  );
}
