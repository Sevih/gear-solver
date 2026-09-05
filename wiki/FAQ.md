# FAQ & Troubleshooting

Common questions and fixes for players. For how the app works internally, see
[Architecture](Architecture) and the [Capture Pipeline](Capture-Pipeline).

---

## Importing my account

**Steam or emulator — which source should I use?**
**Steam** if you have the PC client: nothing to root, nothing to configure, and your account
re-imports every time you reach the lobby. The emulator path exists for players without the
Steam client. Switch anytime in **Settings → Setup** (top of the pane).

**(Steam) "Install plugin" says the game must be closed.**
Two cases lock files in the game folder: the first install of the BepInEx loader, and updating
a plugin the running game has already loaded. Quit OUTERPLANE, click Install again, relaunch.
A first install while the game runs *without* any plugin yet is fine — just restart the game
afterwards so it loads.

**(Steam) The header says "game up, plugin not loaded" / nothing imports.**
The game was started before the plugin was installed (or BepInEx isn't loading). Restart the
game. If it persists, look at `BepInEx/LogOutput.log` in the game folder — it should list
*Gear Solver Capture* and "hooked CWebManager…"; an antivirus quarantining `winhttp.dll` in
the game folder is the usual culprit.

**(Steam) What does the plugin do to my game?**
It reads the responses the game already received and copies them to the app's folder. It
changes nothing in the game, sends nothing to the server, and can be removed from
**Settings → Setup → Remove plugin**. It is still a third-party mod loaded into the client —
same category as the emulator interception.

**(Emulator) Nothing shows up after I click Arm capture.**
Play the game **through to the lobby** (main town screen) — that's when OUTERPLANE sends your
account + inventory. Then click **Reload** in gear-solver. If it's still empty, check the next
item.

**(Emulator) The setup checklist won't go green / "ADB connection" or "Root toggle" fails.**
- Make sure LDPlayer is **running** with OUTERPLANE open.
- Turn **Root permission ON** in LDPlayer (Settings → Other settings → Root → ON) and **restart
  the instance** — root must be on *before* you capture.
- Re-open the **Setup** wizard (gear icon) and re-run the checks.

**My hero stats are slightly off vs the in-game character sheet.**
Two stat sources (Codex and Geas) aren't sent on the lobby screen. Open the in-game **Hero
Archive (Codex)** and **Gift / Geas** screens once: on Steam they import as they load; on the
emulator do it with capture still **armed**, then click **Disarm** in gear-solver. Your stats
will then match exactly.

**Do you upload my account anywhere?**
No. Capturing reads the game's network responses **locally on your PC**; saved builds and presets
live in the app's local storage. Nothing leaves your machine.

---

## After a game patch

**Stats or items look wrong / outdated after an OUTERPLANE update.**
The app refreshes its game tables on launch, but you can force it: **Settings → Data → Sync game
data**, then **re-capture** your account. The loaded snapshot's version is shown in
**Settings → Data** (a short hash) so you can confirm it changed.

---

## Using the Builder

**The Builder returns "no builds".**
Your rules are too strict for your inventory. Common causes:
- A **set requirement** you can't physically complete (not enough pieces of that set).
- **Stat filters** set too high (e.g. Speed ≥ 250 when nothing reaches it).
- **Top %** set very low — raise it (lower Top % is faster but can drop valid builds).
The empty-state message lists which slot dropped to zero pieces after filtering.

**SOLVE CP is slow.**
CP is heavier to compute than Score. Lower the **Top %**, add a few **filters** to shrink the
search, or use **SOLVE** with priorities if you just want a stat profile.

**A solve is taking too long.**
Click **Cancel** to stop it. Note you usually get *no* partial results — only work chunks that
had already fully finished are kept, which is typically none. Then tighten **Top %** / filters,
or raise the worker count in **Settings → Solver** (Auto already uses most of your CPU), and
re-solve.

**What's the "Upg" column?**
How many gear slots a build changes vs what the hero currently wears. Low Upg = a small upgrade
you can equip with few swaps; high Upg = a bigger reshuffle.

**SOLVE vs SOLVE CP — which do I use?**
- Use **SOLVE** when you know the stats you want (set priorities, optionally stat filters).
- Use **SOLVE CP** when you just want the highest in-game Combat Power.

**Can the app equip gear onto my heroes for me?**
Locally, yes: the Builder's **Equip build** button applies the selected build to your captured
snapshot (after a confirmation popup), and the **Worklist** tab has **Apply locally** /
**Apply all** for queued changes. What it *can't* do is push changes into the actual game —
there's no game API for that, so these only edit the local snapshot. Use the Worklist as a
checklist while you equip the pieces in-game yourself.

---

## Builds & data management

**Where are my saved builds stored? How do I move them to another PC?**
In the app's local storage. Use **Settings → Backup → Export** to download them as JSON, then
**Import** on the other PC. Captured gear isn't part of the backup — re-capture your account
there.

**I want a clean slate.**
**Settings → Data → Wipe captured data** removes the imported snapshot (it's blocked while a
capture is still armed — Disarm first).

---

## Still stuck?

Open an issue on the [repository](https://github.com/Sevih/gear-solver/issues) with what you did
and what you saw.
