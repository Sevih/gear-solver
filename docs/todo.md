# TODO — backlog gear-solver (consolidé)

> Backlog opérationnel unique. Le détail des items **livrés** vit dans
> l'historique git + la section « Livré » en bas (et [roadmap.md](roadmap.md)).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence · ⚪ nit.
>
> **Tous les 🔴 sont faits.** Ce qui reste = 🟠 perf, polish 🟡/⚪, features, gros
> chantiers tests, « à vérifier en jeu » et la vérif packaging.

---

## Reste à faire

### 🟠 Perf solver
- [ ] **Solver CP trop lent** — le mode SOLVE CP met beaucoup trop de temps. Investiguer (CP calculé
      in-loop par combo : profiler, mémoïser ce qui peut l'être, voir si un pré-filtre réduit le pool).
- [ ] **Accumulateur de buckets — re-sum déféré** — le hoist des set bonuses est fait ; reste le re-sum
      des 6+EE pièces par talisman. Gain marginal + **risque d'ordre flottant** (`incSet/decSet` casse la
      bit-identité, aucun test stat-locks ne rattrape une dérive ULP via `Math.trunc`). À faire en
      préservant l'ordre exact + test d'équivalence dédié.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) · **SharedArrayBuffer** pour le flag
      `cancelled` (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings` · **Pré-filtrage armor** par
      set requis (restreindre les pools armor au set quand un seul req-4pc actif).

### 🟡/⚪ UX-cohérence & nits
- [ ] 🟡 **`SlotMini` non cliquable (Builds)** — aucun moyen d'inspecter une pièce depuis la tab Builds
      (tooltip/clic), contrairement à l'Inventory.
- [ ] ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** alors que l'accessoire a un main user-sélectionnable
      → placeholder potentiellement faux quand aucun build n'est sélectionné. *(laissé pour ne pas
      diverger du panneau Inventory qui partage la map)*
- [ ] ⚪ **Optims mineures Inventory (si profilage)** — `computeQuality` recalculé plusieurs fois par pièce
      (précalculable dans `toUiPiece`) · double virtualisation (`contentVisibility:auto` redondant avec
      `react-virtual`) · 7 `useMemo` d'availability fusionnables en une passe.
- [ ] 🟡 **`Advices tab builder`** — on considere Missing que si il a 1 EE + 3 autres piece (si il a juste 1EE 
      alors c'est pas du missing mais juste un truc dont on se fiche). Advice si un perso a plus de 102% de crit et a des gems CHC sur le talisman/EE.
- [ ] 🟡 **`Apparence UX tab builder`** — l'UX n'est pas propre. voir pour faire un prompt et le donner a claude 
      design

### Features
- [ ] **Settings — options globales** — panneau pour worker count override · topK/topN · heatmap on/off
      (en plus des debug toggles déjà là).

### À vérifier EN JEU
- [ ] **Cap de Quality ne scale pas avec les étoiles** — `computeQuality` fixe `max = 14 + reforge.n`
      (spread 6★), mais `SubstatRow` considère `isMax = s.lv >= stars` → une pièce 5★ plafonne ses subs
      plus bas → risque que les < 6★ soient classées "Poor"/"Decent" et écartées par le filtre Quality.
      **Confirmer en jeu** si le cap doit dépendre de `stars` (ne pas présumer).

### Persistence
- [ ] **Snapshot `data/` versioning** — stamper un hash/timestamp à chaque rebuild de `data/derived` pour
      invalider les caches localStorage après un patch jeu (les SavedBuild référencent des `pieceUids`
      qui peuvent disparaître).
- [ ] **Equip / Unequip** — bloqué : nécessite une API jeu inexistante (retiré du UI). À reprendre si le
      pipeline de capture peut un jour envoyer des commandes au jeu.

### Tests (fixtures lourdes)
- [ ] **CP solver vs Builds** — comparer `calcBattlePower` sur le même build depuis les deux écrans
      (doit donner 0-diff).
- [ ] **mid-tree pruning** — fixture req-4pc Sharp + 1 helmet Sharp : compteur de combos visités
      strictement < combos sans prune.

### Externe — Packaging desktop (vérif sur un vrai build, le plumbing existe)
- [ ] Bake prod du `data/` (`extraResources` → `process.resourcesPath`) · `electron build`/installeur
      lance serveur local + renderer · auto-update contre release signée + feed réels · bouton capture
      natif en packagé (sans `npm run dev`).

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.

---

## Livré

### Session 2026-06-25 — gros chantiers (détail dans git)

**🔴 Stat de dégâts** (`fcfce9c`, `67996e4`) — `dmg/dmgs/mcd` scalent sur la vraie stat du héros
(main `dmgStat` def/hp + secondaires `dmgSec` `[{stat,ratio}]`), source = `damage-calc/buffs/{id}.json`
d'outerpedia ; Caren=DEF, D.Stella=ATK+HP×0.03.

**🔴 Overcap crit** (`5521258`) — alloc gemmes **par combo** consciente du cap : `allocateGemsCapped`
stop crit à 100 % CHC (overshoot ≤102), hot-loop fast/slow-path (slow uniquement si `fs.crc > 102`).

**🔴 Détection items / effets** (`216ebf5`, `2ed0d3c`, `d35031f`) — filtre d'effets sur `setId`
(identité unique, Recklessness × 5 distincts) ; `effectIcon` sourcé de `ItemSpecialOptionTemplet.IconName`
(complet, 645/645) ; placeholder à initiales si pas d'icône.

**SetPlan — sets OR-de-AND** (`e4ce42a`, `cb49a48`) — contrat `setPlans: SetPlan[]` + `excludedSets`,
moteur `setsFeasible`/`planFeasible`, **UI éditeur OR** (modes Require/Exclude, onglets de plans, résumé
« Match »), helpers purs + 13 tests. → on peut saisir « 4pc A OU (2pc A + 2pc B) ».

**Get Preset — import recos outerpedia** (`5e03232`, `cfdad7e`) — proxy `/api/reco/:id` (dev+prod),
`fetchReco`, traducteur pur `reco→RecoFilterPatch` (mains/effets/sets/priorité, 10 tests), action
`mergePreset` (overlay), bouton + `RecoBuildPicker`.

**Sync data au lancement + bouton** (`c1bdc94`) — `data-sync.ts` (port Node de `sync.ps1`), auto au
démarrage desktop (gardé par fraîcheur) + bouton « Sync game data » dans Settings.

**JSON backup** (`9040725`) — export/import des builds+presets en JSON (Settings), module pur
`transfer.ts` + 8 tests.

**Logger gaté** (`b2c0dd5`, `ccaba4d`) — `gs.debug.*` renderer (solver fan-out) + `GS_DEBUG` desktop
(lifecycle serveur/capture, `dwarn` toujours-on), toggle Settings.

**Builder polish** — colonnes tail-stats révélées quand filtrées (`c77ed1f`) · heatmap valeur affichée
+ gradient interpolé (`8be2c70`, `7216d77`) · a11y combobox (`3d27f1d`) · Top% no-op hint + slider de
hauteur de table (`299a400`) · empty state Builds (`f4543da`) · error boundary global (`6901f69`) ·
footgun filtre warn-once (`2bfb42a`).

### Session 2026-06-25 — antérieur (détail dans git)

**🔴 Correctness solver/UI** — recall filtre CP/upg in-loop (`a6aa67b`) · échecs silencieux +
`restoreBuild`/`solveError` (`2e6def2`) · gem allocation affichée (`20d3ce9`) · bandeau stats reforgées
(`8b1df0e`). **Trous Builds** — Optimize→ câblé (`6f0617b`) · roster « N equipped · M total » (`b832c7b`)
· `computeAdvice` data-driven (`7700456`). **Inventory** — recherche restaurée (`51a489e`).
**Perf solver** — workers idle cappés (`35bf809`) · table virtualisée (`197fc61`) · hoist
`computeSetBonuses` (`92e84ca`). **Desktop robustesse + sécu** — orphelin mitmdump, I/O, liveness
(`c0f039c`) · gardes Host/Origin, redirect `/img/*`, cap body (`9f8fefe`). **Perf Builds** (`87306fe`).
**Polish** — `useClickOutside` (`5f6bb79`) · modal Esc+autofocus (`4f0649a`) · Builds responsive
(`611c49f`) · footer (`8203c25`) · doc-comments (`a46ba66`). **Data** — split BuffID EE virgule, +50% CHD
d'Eris récupéré (`a6dfb16`). **Docs** — passe de cohérence (data-schema, reference, STATUS, solver,
roadmap, architecture, capture README).

### Antérieur (rappel — détail dans roadmap.md)

Solver M6.5 : cancel mid-solve · panneau Library (Save/Remove) · Exclude-equipped multi-select · colonne
Upg · simulation de reforge · tri de colonnes. — Persistence M7 : Save Build / Filter presets per hero. —
Tests : stat-lock · gem override · top-K heap. — Hygiène : stubs morts `solver.ts`/`score.ts` supprimés.
