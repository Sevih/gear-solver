# FAQ & Troubleshooting

Common questions and fixes for players. For how the app works internally, see
[Architecture](Architecture) and the [Capture Pipeline](Capture-Pipeline).

---

## Importing my account

**Nothing shows up after I click Arm capture.**
Play the game **through to the lobby** (main town screen) — that's when OUTERPLANE sends your
account + inventory. Then click **Reload** in gear-solver. If it's still empty, check the next
item.

**The setup checklist won't go green / "ADB connection" or "Root toggle" fails.**
- Make sure LDPlayer is **running** with OUTERPLANE open.
- Turn **Root permission ON** in LDPlayer (Settings → Other settings → Root → ON) and **restart
  the instance** — root must be on *before* you capture.
- Re-open the **Setup** wizard (gear icon) and re-run the checks.

**My hero stats are slightly off vs the in-game character sheet.**
Two stat sources (Codex and Geas) aren't sent on the lobby screen. With capture still **armed**,
open the in-game **Hero Archive (Codex)** and **Gift / Geas** screens, then click **Disarm** in
gear-solver. Your stats will then match exactly.

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
Click **Cancel** — you keep the best results found so far. Then tighten **Top %** / filters, or
raise the worker count in **Settings → Solver** (Auto already uses most of your CPU).

**What's the "Upg" column?**
How many gear slots a build changes vs what the hero currently wears. Low Upg = a small upgrade
you can equip with few swaps; high Upg = a bigger reshuffle.

**SOLVE vs SOLVE CP — which do I use?**
- Use **SOLVE** when you know the stats you want (set priorities, optionally stat filters).
- Use **SOLVE CP** when you just want the highest in-game Combat Power.

**Can the app equip gear onto my heroes for me?**
Not from the UI yet. gear-solver shows you the optimal build; you equip it in-game. (The
groundwork for editing equipment locally exists but isn't wired to a button.)

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
