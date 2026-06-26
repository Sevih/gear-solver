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
- [x] **gems strategy** — allocation **étagée cap-reaching** : étage 1 atteint le cap CHC à 100 %
      avec les gems crit (même si l'atk score plus haut), étage 2 remplit par priorité (skip crit).
      Gaté sur `crc priority > 0` + pool crit, recompose seulement si le delta diffère du greedy
      (`allocateGemsReachingCap` / `gemDeltaEquals`). Étage 2 = priorité actuelle (pas de profil séparé).
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
- [x] 🟡 **Apparence UX tab builder** — direction **B (toolbar + popovers)** portée dans `BuilderScreen`
      (toolbar : hero · Solve/Solve CP · toggles Reforged/Maxed · popovers Options/Stat/Ratings/Priority/Mains/Sets/Effects
      avec badges de comptage ; table quasi pleine largeur + colonne droite stats→projetées + library). Brief :
      [docs/design/builder-redesign-brief.md](design/builder-redesign-brief.md). Toute la logique (reducer/solve/persistance)
      préservée — seul le layout a changé.

### Builder — suites du review post-direction-B
- [x] Toggles Reforged/Maxed dupliqués (inline + popover Options) → retirés du popover (`a4108db`).
- [x] Popovers + header de table semi-transparents (`bg-elev-2` = 70% alpha) → backing opaque `bg-elev-1` (`a4108db`).
- [x] Main-stat de l'EE masquée dans la gear band (fixe ATK%, une seule option) (`a4108db`).
- [n/a] Top% « perdu » → en fait toujours là, dans le popover **Priority** (sa place logique). À surfacer si besoin.
- [n/a] Gems déjà présentes affichées → `GemRecommendation` ne montre déjà QUE les gems proposées (+ badge swap).
- [x] 🟢 **Bouton « Filter »** — re-filtre client-side des résultats stockés par les bandes stat/rating sans
      re-solve (instantané après le 1er calcul) ; sélection/gear band indexent la vue filtrée, ✕ pour annuler (`44170ae`).
- [x] 🟢 **Filtre qualité** — select « Min quality » (Options) qui exclut du pool les pièces sous le tier choisi ;
      seuils partagés via `lib/quality.ts` (plus de divergence avec l'Inventory) (`d06f06f`).
- [x] 🟡 **Abréviations stats** — labels alignés sur `outerpedia-v2/data/stats.json` (CHC/CHD/CDMG RED%/PEN%/DMG UP%/…)
      + **en-têtes du tableau en icônes** (plus de texte). `CDR` ambigu (= Cooldown pour l'user) → `CDMG RED%`.
      (CDR avait été retirée à tort sur un malentendu d'abréviation → restaurée.)
- [~] 🟡 **Show/hide colonnes** — menu « Columns » dans le header (stats/ratings/score/upg, persistant, possibilité d'acces avec un click droit sur les entete de colonne ;
      colonne filtrée = forcée visible) (`c8808d4`).
- [x] 🟡 **Tooltips en-têtes** — nom complet + définition (TextSystem `SYS_DESC_*`) au survol (`5fa5037`).
- [x] 🔴 **Colonne Set cassée** — rendait `—`, jamais implémentée → set tags par build (icône + tier 2/4) (`500fb26`).
- [x] 🟡 **Colonnes arme + accessoire** — effets d'arme/accessoire par build (icône + nom au survol), toggleables
      via le menu Columns (`a08f9b6`).
- [ ] 🟡 **Conservation des resultats** — il faut conserver les rsultats du solver quand on 
      change de tab (voir meme permettre de laisser le solver tourner).
- [ ] 🟢 **reset des filtres** — tab inventaire et builds actuelement conserve les tries meme 
      apres relance de l'app et on veut pas
> **▶ Prochaine session** — les 2 items ci-dessous restent du review post-direction-B (tout le reste est livré).

- [x] 🟡 **Reforge / upgrade dans la gear band** — **3 modes globaux** `reforgeMode` (segmented control
      toolbar) remplacent le bool `useReforged` : **disable** · **classic** (+10 / 6 ticks) · **ascended**
      (+15 / 9 ticks, projette tout comme ascensionné). Projection complète = main re-scalé (core
      `projectMainToCeiling`, ratio des mults, validé in-game) + substats reforgés au budget du mode
      (`simulateReforges` budget paramétrable), centralisé dans `projectPieceForReforge` (partagé engine ↔
      gear band). La carte affiche l'enhance projeté (`+15 · ascended`) + badge **classic/ascended** + ticks.
      *(Reste possible si besoin : un indicateur explicite "needs upgrade" vs déjà au plafond.)*
- [x] 🟠 **Solve sous-utilise le CPU** — cause : plafond fixe à 8 workers (8/32 threads = 25 %). Fix :
      `resolveWorkerCount()` = `hardwareConcurrency − 1` (1 cœur pour l'UI, plafond dur 64) + override
      `gs.solver.workerCount` + log debug `solver`/`pool` (workers + hardwareConcurrency) pour vérifier.
      Payload réduit en amont (**send-once**) : `game` + inventaire clonés vers chaque worker une
      seule fois (`init`, cachés worker-side) au lieu d'à chaque solve → le fan-out ne porte plus
      que le payload allégé + précalcul. Reste possible si inventaire énorme : SharedArrayBuffer (§8).
      *(À vérifier sur ta machine : le solve doit maintenant saturer ~tous les cœurs.)*

### Features
- [ ] **Settings — options globales** — panneau pour worker count override · topK/topN · heatmap on/off
      (en plus des debug toggles déjà là). prevoir meme une refonte graphique / orga de la fenetre settings

### À vérifier EN JEU
- [ ] **Cap de Quality ne scale pas avec les étoiles** — `computeQuality` fixe `max = 14 + reforge.n`
      (spread 6★), mais `SubstatRow` considère `isMax = s.lv >= stars` → une pièce 5★ plafonne ses subs
      plus bas → risque que les < 6★ soient classées "Poor"/"Decent" et écartées par le filtre Quality.
      **Confirmer en jeu** si le cap doit dépendre de `stars` (ne pas présumer).

### Persistence
- [ ] **Snapshot `data/` versioning** — stamper un hash/timestamp à chaque rebuild de `data/derived` pour
      invalider les caches localStorage après un patch jeu (les SavedBuild référencent des `pieceUids`
      qui peuvent disparaître).
- [ ] **Equip / Unequip** — modifier les emplacements des equipements sur les personnages. on n'envoi rien au 
      jeu (on modifie les fichiers que l'on a recuperer)

### Tests (fixtures lourdes)
- [ ] **CP solver vs Builds** — comparer `calcBattlePower` sur le même build depuis les deux écrans
      (doit donner 0-diff).
- [ ] **mid-tree pruning** — fixture req-4pc Sharp + 1 helmet Sharp : compteur de combos visités
      strictement < combos sans prune.

### Externe — Packaging desktop (vérif sur un vrai build, le plumbing existe)
- [ ] Bake prod du `data/` (`extraResources` → `process.resourcesPath`) · `electron build`/installeur
      lance serveur local + renderer · auto-update contre release signée + feed réels · bouton capture
      natif en packagé (sans `npm run dev`).
- [ ] **Vérif sync repo en prod packagé** (plumbing posé, items 5-10 du plan asset-sync) — 1er lancement
      online : seed `data/derived` bundlé → sync SHA → download tables+buffs → rebuild ; images peuplent
      le cache à la demande + préfetch `ui/`+`equipment/`. Vérifier `/img/*` ne tape jsDelivr/raw que sur
      miss (127.0.0.1 ensuite, 302 outerpedia.com seulement si CDN down) · 2e lancement SHA inchangé =
      instantané · simuler un patch (`OUTERPEDIA_REF` autre branche) · offline cold-cache = pas de crash.

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.

---

## Livré

### Session 2026-06-26 — assets & game-data sync depuis le repo GitHub

**🔴 Images + game-data sourcés du repo `Sevih/outerpediaV2` (sync au lancement)** — déclencheur :
404 sur `CT_Slot_Lock.png` → `/img/*` ne venait pas du projet (checkout local en dev, 302 outerpedia.com
en prod, bundle d'images cassé `outerpedia-v2` → installeur sans aucune image). Nouveau modèle : handler
`/img/*` partagé (`img-cache.ts`) checkout→cache disque→CDN jsDelivr/raw→fallback webp→302 ; `data-sync.ts`
dual-mode (checkout mtime-gated / download CDN SHA-gated via `api.github.com/commits/main`) ; `build.mjs`
dirs via env ; `main.ts` seed derived + pin SHA + préfetch fond ui/equipment ; coords centralisées
`repo-source.ts` ; cache `.cache/outerpedia` (dev) / `<userData>/outerpedia-cache` (prod). Refs `.png`
hardcodées → `.webp`. extraResources : images cassées retirées, `build.mjs`/`calc-stats.mjs` shippés.
→ l'app suit les patchs **sans nouveau build**, dépendance internet/site minimisée (1 fetch par asset à vie).

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
