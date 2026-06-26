# TODO — backlog gear-solver (consolidé)

> Backlog opérationnel unique. Le détail des items **livrés** vit dans
> l'historique git + la section « Livré » en bas (et [roadmap.md](roadmap.md)).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> **1 🔴 ouvert** (exclusion de pièce par set). Le reste = 🟠 perf, polish 🟡/🟢/⚪,
> features, gros chantiers tests, « à vérifier en jeu » et la vérif packaging.

---

## Reste à faire

### 🔴 Correctness — pré-filtrage du pool
- [ ] 🔴 **Exclusion de pièce par set** — aujourd'hui seules les armes / accessoires sont effectivement
      écartées selon les filtres (et encore, à confirmer) ; les **sets** ne filtrent pas le pool. Si on
      impose une restriction (ex. `2pc ATK + 2pc PEN`), inutile d'inclure dans les pools armor les pièces
      hors de ces sets. En revanche si on ne demande qu'**un** `2pc`, il faut garder de quoi compléter
      (set demandé + 2 autres pièces). **Prévoir un setting « autoriser les broken sets ».**
      *(Recoupe l'optim « Pré-filtrage armor par set requis » ci-dessous — à traiter ensemble.)*

### 🟠 Perf solver
- [ ] **Solver CP trop lent** — le mode SOLVE CP met beaucoup trop de temps. Investiguer (CP calculé
      in-loop par combo : profiler, mémoïser ce qui peut l'être, voir si un pré-filtre réduit le pool).
- [ ] **Accumulateur de buckets — re-sum déféré** — le hoist des set bonuses est fait ; reste le re-sum
      des 6+EE pièces par talisman. Gain marginal + **risque d'ordre flottant** (`incSet/decSet` casse la
      bit-identité, aucun test stat-locks ne rattrape une dérive ULP via `Math.trunc`). À faire en
      préservant l'ordre exact + test d'équivalence dédié.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) · **SharedArrayBuffer** pour le flag
      `cancelled` (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings` · **Pré-filtrage armor** par
      set requis (restreindre les pools armor au set quand un seul req-4pc actif — cf. le 🔴 ci-dessus).

### 🟡/⚪ UX-cohérence & nits
- [ ] 🟡 **`SlotMini` non cliquable (Builds)** — aucun moyen d'inspecter une pièce depuis la tab Builds
      (tooltip/clic), contrairement à l'Inventory.
- [ ] 🟡 **Conservation des résultats** — conserver les résultats du solver quand on change de tab
      (voire permettre de laisser le solver tourner en fond).
- [ ] 🟡 **Reset des tris/filtres au lancement** — l'état persiste au reload et on n'en veut pas :
      **Inventory** persiste le tri (`gs.inv.sort`/`dir`/`tab`), **Builds** persiste ses filtres
      (`gs.builds.filters` ; pas de tri, fixe CP desc). Repartir d'un défaut au lancement.
- [ ] 🟡 **`Advices` (tab Builder)** — nouvelles règles dans `computeAdvice` ([BuildsScreen.tsx:489-551](../apps/renderer/src/screens/BuildsScreen.tsx#L489)).
      `ComposedEntry` expose : stats finales, baseline sans gear, pièces brutes (gems/subs/reforge/enhance/
      ascended/quality/sets), `meta.dmgStat`. **Lot prioritaire** (haute confiance, données déjà là) :
      1. **Caps gaspillés** — `crc > 100` (surtout si gems CHC sur talisman/EE) · `dmgRed > 70` (mitigation
         plancher 0.3 → cap 70 %, *seuil à valider en jeu*) · `pen > 100` (cappe à 100). « X % gaspillés,
         réallouer ». Caps déjà dans le modèle (ratings.ts), juste à comparer.
      2. **Gems** — slots de gem vides sur talisman/EE (`gemSlots` à 0) · 5ᵉ slot verrouillé si
         `enhanceLevel < 5`.
      3. **Upgrade** — reforges non utilisés (`reforgeCount < maxReforges`) · pièces non max-enhance · 6★
         non ascensionné (agréger pour éviter le bruit).
      4. **Réduction de bruit Missing** — le flag est déjà correct (6 slots core, EE/Talisman exclus) mais
         s'affiche sur tout perso incomplet ; le suppresser sur les persos peu équipés (seuil ~1 EE + 3 pièces).
      **Lot secondaire** (confiance moyenne / refacto) : main off-scaling vs `meta.dmgStat` · pièce de
      basse qualité équipée · « 4pc complet dispo en inventaire » / « effet d'arme manquant »
      (*nécessite de passer l'inventaire complet à `computeAdvice`*).
- [ ] 🟡 **Show/hide colonnes — accès clic-droit** — le menu « Columns » existe (`c8808d4`) ; ajouter
      l'ouverture via clic-droit sur les en-têtes de colonne.
- [~] ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** (wontfix assumé) — placeholder faux quand aucun build
      n'est sélectionné (l'accessoire a un main user-sélectionnable), mais **laissé volontairement** pour
      ne pas diverger du panneau Inventory qui partage la map. À ne reprendre que si les deux maps divergent.
- [ ] ⚪ **Optims mineures Inventory (si profilage)** — `computeQuality` recalculé plusieurs fois par pièce
      (précalculable dans `toUiPiece`) · double virtualisation (`contentVisibility:auto` redondant avec
      `react-virtual`) · 7 `useMemo` d'availability fusionnables en une passe.

### 🟢 Features
- [x] 🟢 **Rentabilité % vs Flat (subs)** — encadré **"Sub tick value"** dans le Builder (entre current→projected
      et la library) : par héros, la valeur d'un tick de sub 6★ en flat ET en % (≈ équivalent flat), gagnant en
      cyan. Math : un tick % scale sur `base+evo+awak` (gear-indépendant — le flat gear est ajouté après le ×% ;
      le `(1+buffRate)` s'annule) → verdict = fonction de la base seule. Valeurs par tick = `subStatPools`
      d'outerpedia (`item-stats-detail.json`) → dérivé `sub-ticks.json` ; logique pure `lib/subValue.ts` (+5 tests).
      6★ : ATK 40/4% · DEF 40/4% · HP 73/3% (bascule vers % au-dessus de base 1000 / 1000 / 2433).
- [x] 🟢 **Rentabilité dégâts par tick (subs offensifs)** — 2ᵉ encadré **"Damage / tick"** : gain de dégâts
      attendu par tick de sub 6★ pour le héros — stat de dégât % (ATK/DEF/HP selon `dmgStat`) vs **CHC** vs
      **CHD** vs **DMG UP%**, classé, meilleur en cyan (CHC ≈ 0 % si crit-cap). Réutilise le modèle de dégâts
      validé `computeCheapRatings` (crit/DMG±/PEN, formules 1.4.9) : on bump une stat d'un tick et on recompare
      `.dmg`. Le tick % de la stat de dégât monte le final de `base × pct% × (1+buffRate)` ; CHC/CHD/DMG UP
      sont additifs. Ticks 6★ : CHC 3 % · CHD 4 % · DMG UP 2 %. Logique pure `lib/dmgValue.ts` (+4 tests).

### À vérifier EN JEU
- [ ] **Cap de Quality ne scale pas avec les étoiles** — `computeQuality` fixe `max = 14 + reforge.n`
      (spread 6★), mais `SubstatRow` considère `isMax = s.lv >= stars` → une pièce 5★ plafonne ses subs
      plus bas → risque que les < 6★ soient classées "Poor"/"Decent" et écartées par le filtre Quality.
      **Confirmer en jeu** si le cap doit dépendre de `stars` (ne pas présumer).

### Persistence
- [ ] **Snapshot `data/` versioning** — stamper un hash/timestamp à chaque rebuild de `data/derived` pour
      invalider les caches localStorage après un patch jeu (les SavedBuild référencent des `pieceUids`
      qui peuvent disparaître).
- [ ] **Equip / Unequip** — modifier les emplacements d'équipement sur les personnages. On n'envoie rien
      au jeu (on modifie les fichiers capturés qu'on a récupérés).

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

### Session 2026-06-26 — solver tuning, reforge/gems, settings, assets sync

**Settings — refonte left-rail à onglets + section Solver** (`85b8a86`) — onglets Setup · Solver · Data ·
Backup · Debug avec footer contextuel (Re-check sur Setup seulement). Section **Solver** : worker count
Auto/Manual (dispose+rebuild du pool au changement), result count (topN), per-worker depth (topK, derrière
« Show advanced » + warning recall), heatmap on/off. Réglages persistés App `usePersistedState`,
`resolveWorkerCount(override)` + footer réactif, topN/topK dans `startSolve`, heatmap gate `ResultsTable`
(`EMPTY_RANGES`). Brief design : `docs/design/settings-redesign-brief.md`.

**Solve sous-utilise le CPU → pool adaptatif + send-once** (`f532d42`, `2022df4`, `c8e93c4`) — plafond fixe
8 → `hardwareConcurrency − 1` (1 cœur pour l'UI, override `gs.solver.workerCount`, plafond dur 64) ;
`game` + inventaire envoyés à chaque worker **une fois** (`init`, cachés worker-side) au lieu d'à chaque
solve ; compteur « ⚙ N workers » dans le footer Builder.

**Reforge 3 modes + gems cap-reaching** (`20ab51e`) — `reforgeMode` disable / classic (+10, 6 ticks) /
ascended (+15, 9 ticks) remplace le bool `useReforged` ; projection complète = main re-scalé
(`projectMainToCeiling`, validé in-game) + substats (`simulateReforges` budget), centralisé dans
`projectPieceForReforge`. Gems étagées : cap CHC à 100 % d'abord (gems crit) puis priorité
(`allocateGemsReachingCap` / `gemDeltaEquals`).

**Images + game-data sourcés du repo `Sevih/outerpediaV2` (sync au lancement)** — déclencheur : 404 sur
`CT_Slot_Lock.png` → `/img/*` ne venait pas du projet (checkout local en dev, 302 outerpedia.com en prod,
bundle d'images cassé). Nouveau modèle : handler `/img/*` partagé (`img-cache.ts`)
checkout→cache disque→CDN jsDelivr/raw→fallback webp→302 ; `data-sync.ts` dual-mode (checkout mtime-gated /
download CDN SHA-gated via `api.github.com/commits/main`) ; `build.mjs` dirs via env ; `main.ts` seed
derived + pin SHA + préfetch fond ui/equipment ; coords centralisées `repo-source.ts` ; cache
`.cache/outerpedia` (dev) / `<userData>/outerpedia-cache` (prod). Refs `.png` → `.webp`. extraResources :
images cassées retirées, `build.mjs`/`calc-stats.mjs` shippés. → l'app suit les patchs **sans nouveau
build**, dépendance internet/site minimisée (1 fetch par asset à vie).

**Builder — table & filtres** — colonne Set par build (icône + tier 2/4) (`500fb26`) · colonnes arme +
accessoire (effet icône + nom) toggleables (`a08f9b6`) · menu « Columns » show/hide (stats/ratings/score/upg,
persistant, colonne filtrée forcée visible) (`c8808d4`) · tooltips d'en-tête (nom complet + def TextSystem)
(`5fa5037`) · abréviations stats alignées sur outerpedia + en-têtes en icônes (CDR→CDMG RED%) · bouton
« Filter » (re-filtre client-side sans re-solve) (`44170ae`) · filtre « Min quality » (seuils partagés
`lib/quality.ts`) (`d06f06f`).

**Builder — polish direction-B** — toggles Reforged/Maxed dé-dupliqués (`a4108db`) · popovers + header de
table opaques (`bg-elev-1`) (`a4108db`) · main-stat EE masquée dans la gear band (`a4108db`). Layout
direction B (toolbar + popovers) : brief `docs/design/builder-redesign-brief.md` ; logique
(reducer/solve/persistance) préservée.

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
