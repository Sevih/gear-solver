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
- **LDPlayer** (Android emulator) with:
  - **OUTERPLANE installed** and logged into your account,
  - **Root toggle ON** (LDPlayer → Settings → Other settings → Root permission → ON, then restart the instance),
  - **ADB enabled**.
- The gear-solver app itself (installer, or run from source — see the [README](https://github.com/Sevih/gear-solver/blob/main/README.md)).

> Why root + LDPlayer? Importing your account reads the game's own network responses locally on
> your PC. Nothing is ever sent anywhere — your data stays on your machine. (Details:
> [Capture Pipeline](Capture-Pipeline).)

---

## 2. First launch — the setup wizard

On first launch the app opens a **Setup wizard** (you can re-open it anytime from the gear icon
in the top-right). It runs a short checklist:

1. **Emulator installed** — LDPlayer detected.
2. **Emulator running** — your instance is up.
3. **ADB connection** — the app can talk to the emulator.
4. **Root toggle** — root permission is ON.

When all four are green, you're ready to import.

---

## 3. Import your account ("capture")

Importing reads your gear + heroes straight from the game. It's a **one-button** flow from the
header:

1. Launch OUTERPLANE inside LDPlayer.
2. In gear-solver, click **Arm capture** (top of the window).
3. In the game, **play through to the lobby** (the main town screen). This makes the game send
   your account + inventory, which the app captures automatically.
4. Back in gear-solver, click **Reload** if the inventory doesn't appear on its own.

That's it — your gear and heroes now show up in the **Inventory** and **Builds** tabs.

### Grab the extra stats (codex + geas)

A couple of stat sources aren't sent on the lobby screen, so your composed stats can be **very
slightly** off until you grab them:

1. With the pipeline still **armed**, in the game open the **Hero Archive (Codex)** screen and
   the **Gift / Geas** screen.
2. Back in gear-solver, click **Disarm**. The app picks up those two extra payloads and your
   hero stats now match the in-game sheet exactly.

> The app leaves capture **armed** after a successful import precisely so you can do this. When
> you're done, **Disarm** tears the pipeline down cleanly. (It also disarms automatically when
> you quit the app.)

### Re-capturing later

Re-run **Arm capture → lobby → Reload** anytime your account changes (new gear, enhanced a
piece, leveled a hero…). The app always auto-imports the most recent capture on launch.

---

## 4. Next steps

- Browse what you own and read each piece → **[Using the App → Inventory](Using-the-App#inventory--browse-your-gear)**
- See your heroes' current stats + suggestions → **[Using the App → Builds](Using-the-App#builds--your-heroes)**
- Find the best gear for a hero → **[Using the App → Builder](Using-the-App#builder--optimize-a-hero)**
- Something not working? → **[FAQ & Troubleshooting](FAQ)**
