# Getting Started

A player's guide to installing gear-solver, importing your OUTERPLANE account, and getting
your first optimized build. **No technical background needed** — if you want to know how the
app works under the hood, see [Architecture](Architecture) instead.

> **What gear-solver does for you:** it reads your account's gear and heroes, then finds the
> best gear combinations for any hero you pick — under the stat / set rules you choose. Think
> Fribbels (Epic Seven), for OUTERPLANE.

---

## 1. What you need

- **Windows** (the app ships as a Windows desktop installer).
- OUTERPLANE installed **from Steam** and logged into your account. Nothing else: the app drops
  a small capture plugin into the game folder for you. (No Steam client? You can still import
  your snapshot files by hand — the **Manual fallback** picker at the bottom of the window.)
- The gear-solver app itself (installer, or run from source — see the [README](https://github.com/Sevih/gear-solver/blob/main/README.md)).

> Importing your account reads the game's own network responses **locally on your PC** —
> nothing is ever sent anywhere, your data stays on your machine. The plugin reads them from
> inside the game, after the game decrypted them. (Details: [Capture Pipeline](Capture-Pipeline).)

---

## 2. First launch — the setup wizard

On first launch the app opens a **Setup wizard** (you can re-open it anytime from the gear icon
in the top-right). Follow the checklist:

1. **OUTERPLANE installed via Steam** — found automatically.
2. **Capture plugin installed** — click **Install plugin** (one time; close the game first if it
   was already running without the plugin, then restart it).
3. **Game running with the plugin loaded** — launch the game (the wizard has a button for it).

When the checks are green, you're ready to import.

---

## 3. Import your account ("capture")

Importing reads your gear + heroes straight from the game.

### Just play

1. Launch OUTERPLANE from Steam (with the plugin installed).
2. **Play through to the lobby** (the main town screen). The plugin writes your account +
   inventory as the game loads them and gear-solver **imports on its own** within a few
   seconds — no button to press. The header pill reads **Live** while the game runs.
3. For the extra stats (codex + geas), open the in-game **Hero Archive (Codex)** and
   **Gift / Geas** screens once — they import as soon as they load.

Re-importing later = just play again: every lobby load refreshes the snapshot (new gear,
an enhanced piece, a leveled hero…). The app also auto-imports the most recent capture on
launch, and **Reload** (top of the window) re-reads it on demand.

---

## 4. Next steps

- Browse what you own and read each piece → **[Using the App → Inventory](Using-the-App#inventory--browse-your-gear)**
- See your heroes' current stats + suggestions → **[Using the App → Builds](Using-the-App#builds--your-heroes)**
- Find the best gear for a hero → **[Using the App → Builder](Using-the-App#builder--optimize-a-hero)**
- Something not working? → **[FAQ & Troubleshooting](FAQ)**
