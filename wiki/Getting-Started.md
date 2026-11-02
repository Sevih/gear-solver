# Getting Started

A player's guide to installing gear-solver, importing your OUTERPLANE account, and getting
your first optimized build. **No technical background needed** — if you want to know how the
app works under the hood, see [Architecture](Architecture) instead.

> **What gear-solver does for you:** it reads your account's gear and heroes, then finds the
> best gear combinations for any hero you pick — under the stat / set rules you choose. Think
> Fribbels (Epic Seven), for OUTERPLANE.

---

## 1. What you need

- **Windows** or **Linux** (the app ships as a Windows installer and a Linux AppImage, both on
  the [releases page](https://github.com/Sevih/gear-solver/releases/latest)). On Linux the game
  runs under Proton — see [Installing on Linux](#installing-on-linux) below.
- OUTERPLANE installed **from Steam** and logged into your account. Nothing else: the app drops
  a small capture plugin into the game folder for you. (No Steam client? You can still import
  your snapshot files by hand — the **Manual fallback** picker at the bottom of the window.)
- The gear-solver app itself (installer, or run from source — see the [README](https://github.com/Sevih/gear-solver/blob/main/README.md)).

> Importing your account reads the game's own network responses **locally on your PC** —
> nothing is ever sent anywhere, your data stays on your machine. The plugin reads them from
> inside the game, after the game decrypted them. (Details: [Capture Pipeline](Capture-Pipeline).)

### Installing on Linux

1. Download `Outerpedia-Gear-Solver-<version>.AppImage` and put it in a folder you own, e.g.
   `~/Applications` (the app updates itself only from a folder you can write to).
2. Make it executable: `chmod +x Outerpedia-Gear-Solver-*.AppImage` (or file manager →
   Properties → Permissions → *Allow executing file as program*), then double-click it.
3. Install `unzip` if it's missing (`sudo dnf install unzip`, `sudo apt install unzip`…): the
   app needs it to unpack BepInEx when it installs the capture plugin.
4. In Steam, set OUTERPLANE's launch option (Properties → General → Launch Options) to
   `WINEDLLOVERRIDES="winhttp=n,b" %command%`, then restart Steam — without it the plugin never
   loads under Proton. The setup wizard shows whether it's set.

Updates: the new version is downloaded next to the old file under its new name, and the old one
removed (rename the AppImage without its version number to keep a fixed name). If the file sits
somewhere read-only, the update card (Settings › Data & updates) says so and you download the new
AppImage by hand.

---

## 2. First launch — the setup wizard

On first launch the app opens the **Settings** modal on its **Setup** pane — the setup wizard (you
can re-open it anytime with the **Settings** button, the sliders icon at the top-right). Behind
it, the **Heroes** tab says "No account captured yet". Follow the checklist:

1. **OUTERPLANE installed via Steam** — found automatically. Not found? Install the game from
   Steam, or import your snapshot files with the **Manual fallback** picker at the bottom of the
   window.
2. **Capture plugin installed** — click **Install plugin** (one time). The game must be closed
   while it installs: the button is greyed out while the game runs (hover it for the reason). The same
   button sits in the header, top-right, next to the capture pill. On Linux, the wizard also shows
   the Proton launch option to paste (see [Installing on Linux](#installing-on-linux)).
3. **Game running with the plugin loaded** — click **Launch game** (in the wizard or in the
   header), play to the lobby, then click **Re-check** at the bottom of the wizard.

That's four clicks: **Install plugin**, **Launch game**, **Re-check**, then **Close** — the
wizard doesn't close on its own when the three checks turn green. You land on **Heroes**.

---

## 3. Import your account ("capture")

Importing reads your gear + heroes straight from the game.

### Just play

1. Launch OUTERPLANE from Steam (with the plugin installed).
2. **Play through to the lobby** (the main town screen). The plugin writes your account +
   inventory as the game loads them and gear-solver **imports on its own** within a few
   seconds — no button to press. The header's capture pill reads **Live** while the game runs.
   The first import arrives **silently**: no message, the tabs just fill in (**Heroes** shows
   your roster, **Gear** your pieces, the tab badges their counts).
3. For the extra stats (Codex + Geas), open the in-game **Hero Archive** and **Gift** screens
   once — they import as soon as they load. Until then your heroes' stats can sit slightly
   below the in-game character sheet (the wizard's "Ready" box reminds you of this step).

Re-importing later = just play again: every lobby load refreshes the snapshot (new gear,
an enhanced piece, a leveled hero…), and with the game open the moves you make in-game reach the
app within seconds. The app also auto-imports the most recent capture on launch, and **Reload**
(the round-arrow icon, top-right of the window) re-reads it on demand.

### No Steam client? Manual fallback

Until a snapshot is loaded, a **Manual fallback** file picker sits at the bottom of the window:
pick the captured JSON files to import them by hand.

---

## 4. Next steps

The tabs, in the order of a session — **[A typical session](Using-the-App#a-typical-session)**
walks through one:

- See your heroes' current stats + suggestions, rank them → **[Heroes](Using-the-App#heroes--your-roster)**
- Find the best gear for a hero → **[Optimizer](Using-the-App#optimizer--optimize-a-hero)**
- Score your in-game presets for the heroes who share them → **[Presets](Using-the-App#presets--your-in-game-equipment-presets)**
- Work through the gear changes in-game → **[Worklist](Using-the-App#worklist--queued-gear-changes)**
- Browse what you own and read each piece → **[Gear](Using-the-App#gear--browse-your-pieces)**
- Solver, display and backup options → **[Settings](Using-the-App#settings)**
- Something not working? → **[FAQ & Troubleshooting](FAQ)**
