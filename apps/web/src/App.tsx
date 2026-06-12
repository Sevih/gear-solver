import { useState } from "react";
import { parseInventory, type Inventory, type RawUserItem, type RawUserCharacter } from "@gear-solver/core";

/**
 * MVP shell: load the captured JSON (tools/capture/out/user_item.json and
 * optionally user_character.json), parse it with the core engine, and show a
 * summary. The solver UI (filters, results table) builds on top of this.
 */
export function App() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      let userItem: RawUserItem | null = null;
      let userChar: RawUserCharacter | undefined;
      for (const f of Array.from(files)) {
        const json = JSON.parse(await f.text());
        if (json.ItemList) userItem = json as RawUserItem;
        else if (json.CharList) userChar = json as RawUserCharacter;
      }
      if (!userItem) throw new Error("user_item.json (avec ItemList) requis");
      setInv(parseInventory(userItem, userChar));
    } catch (e) {
      setError(String(e));
    }
  }

  const equipped = inv?.gear.filter((g) => g.equippedBy).length ?? 0;

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 880, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Outerplane Gear Solver</h1>
      <p style={{ color: "#666" }}>
        Charge les JSON capturés (<code>tools/capture/out/</code>) :{" "}
        <code>user_item.json</code> et <code>user_character.json</code>.
      </p>

      <input type="file" accept="application/json" multiple onChange={(e) => onFiles(e.target.files)} />

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {inv && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Inventaire</h2>
          <ul>
            <li>{inv.gear.length} pièces de gear ({equipped} équipées, {inv.gear.length - equipped} libres)</li>
            <li>{inv.characters.length} personnages</li>
          </ul>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th>ItemID</th><th>Break</th><th>Reforge</th><th>Singularity</th><th>Subs</th><th>Équipé</th>
              </tr>
            </thead>
            <tbody>
              {inv.gear.slice(0, 50).map((g) => (
                <tr key={g.uid} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{g.itemId}</td>
                  <td>T{g.breakthrough}</td>
                  <td>{g.reforgeCount}</td>
                  <td>{g.singularityLevel}</td>
                  <td>{g.subs.length}</td>
                  <td>{g.equippedBy ? "oui" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: "#999" }}>Aperçu des 50 premières pièces.</p>
        </section>
      )}
    </main>
  );
}
