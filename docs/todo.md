# TODO — backlog gear-solver (consolidé)

> Backlog opérationnel unique. Le détail des items **livrés** vit dans
> l'historique git + la section « Livré » en bas (et [roadmap.md](roadmap.md)).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence · ⚪ nit.
>
> État au 2026-06-25 : **tous les 🔴 sont faits**, la quasi-totalité des 🟠 aussi.
> Ce qui reste ci-dessous = polish 🟡/⚪, features, gros chantiers, ou « à vérifier en jeu ».

---

## Solver / engine

- [x] 🟡 **Footgun : filtres silencieux sur clé inconnue** — ✅ fait : `warnUnknownFilterKey`
      (warn-once via Set) appelé dans la branche clé-inconnue de `passesSpecs`/`passesRatingSpecs`
      → surface un mismatch UI/engine au lieu d'un filtre no-op silencieux. Zéro coût hot-loop
      pour les clés valides. `engine.ts`.
- [x] **CP fallback `chainPassive`** — ✅ vérifié (aucun changement) : `RawCharacter.ChainPassive`
      → `parse.ts` `skills.chainPassive` → `cp.ts` `skillSum += max(0, chainPassive-1)` → BP.
      Lu de la bonne colonne, utilisé par solver (BuilderScreen) ET Builds (`c.skills`).
- [ ] 🟠 **Accumulateur de buckets — partie re-sum déférée** — le hoist des set bonuses
      est fait (cf. Livré) ; reste le re-sum des 6+EE pièces par talisman. Gain marginal,
      et **risque d'ordre flottant** : `incSet/decSet` casserait la bit-identité (soustraction
      flottante ≠ inverse exact) et aucun test stat-locks automatisé ne rattrape une dérive
      ULP via `Math.trunc` dans `composeMultStat`. À faire en préservant l'ordre exact
      (prefix `[0..5]` → talisman → EE/override/sets) avec un test d'équivalence dédié.
- [~] 🔴 **Stat de dégats** — stat principale **faite**, secondaires en reste.
      ✅ **Principale** : `build.mjs` lit `scalings.main` (outerpedia damage-calc) → émet `dmgStat`
      (`def`/`hp`, ATK omis par défaut) sur `characters.json` ; `CharacterDef.dmgStat` ; précalculé
      dans le contexte solver et passé à `computeCheapRatings(fs, dmgStat)` → `dmg/dmgs/mcd/mcds`
      scalent sur la bonne stat (Caren→DEF, HP-scalers→HP ; 15 persos non-ATK). Labels colonne
      `Dmg`/`DmgH` corrigés. Test dédié (101 tests).
      - [ ] **Secondaires avec ratio** (ex. D.Stella ATK+HP×ratio) : `scalings.secondaries` ne porte
        pas le ratio chiffré → il faut l'extraire de `BuffTemplet` (`BT_DMG_OWNER_STAT` Value) côté
        pipeline, puis ajouter une composante additive dans `computeCheapRatings`. Non fait.
- [x] 🔴 **Overcap critique** — ✅ fait : le Score et les ratings cappaient déjà CHC à 100 %, mais
      l'**allocateur de gemmes** notait chaque gemme isolément (précalcul global, CHC-aveugle) →
      empilait des gemmes crit au-delà de 100 %. Fix = **alloc gemmes par combo** consciente du cap
      (décision : exacte) : `allocateGemsCapped` (pur, 7 tests) saute toute gemme crit une fois
      CHC ≥ 100 % (la gemme qui franchit 100 est gardée → overshoot ≤ 102 avec des gemmes 3 %, pour
      **garantir** 100 %). Hot-loop **fast/slow-path** : compose avec le delta par défaut (0 surcoût) ;
      slow-path (ré-alloc + re-compose) **uniquement** si `fs.crc > 102` ET le delta par défaut
      contenait des gemmes crit (= preuve exacte qu'≥1 gemme crit a dépassé le cap). Fast-path
      bit-identique à l'avant. `gems.ts`, `engine.ts`.
- [x] 🔴 **Detection des items dispo** — ✅ fait : le catalogue d'effets Weapons & accessories
      groupait par `effectIcon`, or des effets **différents** partagent une icône (les 5 Recklessness
      partagent `TI_Icon_UO_Weapon_25`) → ils étaient fusionnés en un chip et le filtre matchait les
      mauvais. Basculé catalogue + moteur (`allow`) + chips d'effet sur **`EquipmentDef.setId`**
      (= `UniqueOptionID`, identité d'effet unique), l'icône ne servant plus qu'à l'affichage.
      `effectCatalogFromInventory`, `cycleEffectPick` (clé `key`), `engine.ts` `allow`. Get Preset :
      le traducteur résout `itemId → setId` localement via `game.equipment` (resolver passé à
      `translateRecoBuild`) → **pas besoin de toucher l'API outerpedia**. Presets legacy (clés-icônes)
      nettoyés au load (`filterPresets`) pour éviter un pool vide silencieux.
      *(API outerpedia : enrichir avec l'id unique reste un nice-to-have, non bloquant.)*
- [ ] 🟠 Solver CP met beaucoup trop de temps => comment ameliorer ça
### Perf solver (optionnel, seulement si profilage le justifie)

- [ ] **Profiler un vrai solve** (Chrome DevTools Performance) sur un inventaire moyen
      pour valider les 2-5 s visés.
- [ ] **SharedArrayBuffer** pour le flag `cancelled` — élimine la latence postMessage
      du cancel. Nécessite COOP/COEP headers (Vite + électron prod).
- [ ] **Object pool** pour `FinalStats` + `CheapRatings` — éviter d'allouer × millions.
- [ ] **Pré-filtrage armor par set requis** — si un seul req-4pc est actif, restreindre
      les 4 pools armor aux pièces de ce set (vs prune en chemin).

---

## Tab Builder (`BuilderScreen.tsx` + solver)

- [x] 🟡 **Colonnes manquantes vs filtres** — ✅ fait : la table affiche toujours les 8 stats de
      base, et **appende** automatiquement `dmgUp/dmgRed/eff/res` dès qu'un filtre min/max actif
      porte dessus (`statCols` memoïsé passé à `computeColumnRanges` + `ResultRow`). On ne filtre
      plus jamais sur une colonne invisible ; coût nul tant qu'aucun de ces filtres n'est posé.
      `BuilderScreen.tsx`.
- [x] ⚪ **Heatmap colore sur `v` brut** — ✅ fait : `roundDisplay()` extrait et partagé par `fmt`
      ET `heatCellNew` → la teinte se calcule sur la valeur **affichée** (arrondie), deux cellules
      au même rendu ont la même couleur. `BuilderScreen.tsx`.
- [ ] ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** alors que l'accessoire a un main
      user-sélectionnable → placeholder potentiellement faux quand aucun build sélectionné.
- [x] ⚪ **Accessibilité combobox** — ✅ fait (HeroSelect) : navigation clavier (↑/↓ + Enter),
      `role=combobox/listbox/option` + `aria-activedescendant` + scroll-into-view de l'option
      surlignée ; inputs filtres `type=number` ne changent plus à la molette (`onWheel`→blur).
      `BuilderScreen.tsx`. *(ExcludeHeroesPicker — multi-select — laissé en clic/Esc.)*
- [x] ⚪ **Heatmap des résultats : gradient interpolé** — ✅ fait : `heatStyle` remplace les bands
      Tailwind par un `backgroundColor` rgba interpolé (rose→transparent→emerald, alpha ∝ distance
      à la médiane, pic `HEAT_MAX_ALPHA`) → dégradé continu sans paliers visibles. `BuilderScreen.tsx`.

---

## Sets — généraliser `setPicks` en plans OR (`SetPlan[]`)

> 🟠 Le modèle actuel (`setPicks: Record<setId, "req-2pc"|"req-4pc"|"excluded">`) **ANDe** tous les
> sets requis : impossible d'exprimer « 4pc A **ou** 4pc B », ni « 2pc fixe + 2pc parmi N ». Or c'est
> exactement ce que les recos décrivent (`Set: [[…],[…]]`) et ce qu'on veut pouvoir saisir à la main.
> La généralisation est une seule abstraction qui couvre tous les cas.

**Modèle** :
```
SetRequirement = SetPlan[]            // OR : valide si AU MOINS un plan est satisfait
SetPlan        = { setId, count }[]   // AND : toutes les conditions du plan tiennent
```
Build valide ⟺ `∃ plan, ∀ (setId,count) du plan : setCount[setId] ≥ count`. Les 3 formes d'authoring
ne sont que des raccourcis qui se compilent vers cette liste :
- **N set 4** (un 4pc parmi N) → `[{A:4}]`, `[{B:4}]`, `[{C:4}]`
- **N set 2** (2pc+2pc, 2 distincts parmi N) → toutes les paires `[{A:2},{B:2}]`, `[{A:2},{C:2}]`…
- **1 set 2 fixe + N mix** → `[{F:2},{X:2}]`, `[{F:2},{Y:2}]`…

Taille bornée (N ≤ ~5, armure = 4 slots → `C(5,2)=10` plans max) : zéro risque combinatoire.
`excluded` reste **orthogonal** (un `Set<setId>` filtré en dur sur le pool, inchangé).

- [x] **Contrat** (`solver/types.ts`) — ✅ fait : `setPicks` remplacé par `setPlans: SetPlan[]`
      (`SetPlan = SetCond[]`, OR-de-AND) + `excludedSets: string[]` à part. Le moteur consomme la
      forme **déjà expandée** ; helpers purs dans `solver/setPlans.ts`.
- [x] **Moteur** (`engine.ts`) — ✅ fait :
  - **Validation au leaf** : couverte par `setsFeasible(setPlans, setCount, 0)` à la profondeur boots
    (un plan « faisable avec 0 slot » ⟺ entièrement satisfait) — pas de check séparé.
  - **Prune mid-tree** (`checkSetsFeasible` → `setsFeasible`) : `planFeasible` = `Σ max(0, count −
    have) ≤ remainingSlots`, prune **seulement si AUCUN plan n'est faisable**. La somme par plan est
    en fait **plus stricte** que l'ancien check par-set indépendant (résultats identiques, prune plus tôt).
  - Protection top-% : `requiredSetIds = planSetIds(setPlans)` (union des `setId` de tous les plans).
- [x] **UI Sets** (`BuilderScreen.tsx`) — ✅ fait : `SetsPanel` v2 avec mode **Require/Exclude** +
      **onglets de plans** (Plan 1 | Plan 2 | + OR). En Require, la grille de chips édite le plan
      actif (cycle off→2pc→4pc→off via `nextPlanCount`), un résumé « Match: A ×4 OR B ×2+C ×2 »
      affiche la contrainte complète. Exclude = liste de bannissement globale orthogonale. L'état
      reducer passe à `setPlans: SetPlan[]` + `excludedSets: string[]` ; les plans vides sont droppés
      à la sérialisation moteur ; presets legacy (`setPicks`) migrés via `setPicksToPlans` au load.
- [x] **Tests** — ✅ fait (`test/setPlans.test.ts`, 13 tests) : expansion des chips, `planSetIds`,
      `planFeasible` (somme multi-cond), `setsFeasible` OR + leaf-validation à `remaining 0`, parité
      mono-plan req-4pc.

---

## Get Preset — import des recos outerpedia dans le Builder

> Bouton « Get preset » dans le Builder : interroge l'API reco d'outerpedia pour le héros
> sélectionné et pré-règle les `SolverFilters` (mains / sets / effets arme-accessoire / priorité
> substats). **Le côté outerpedia est FAIT** — l'API renvoie déjà les identifiants partagés ;
> il ne reste que le câblage côté gear-solver.

### Contrat API (déjà livré côté outerpedia)

`GET /api/reco/:id` où `:id` = `CharacterTemplet.ID` = **`hero.charId`** du solver (même espace d'ID,
aucun mapping à faire). `getRecoStatPriorities` joint les recos contre le même dataset jeu que le
solver et renvoie, par build nommé :

```jsonc
"Weapon": [{ "name": "Surefire Greatsword", "itemId": 754,  "effectIcon": "TI_Icon_UO_Weapon_11",    "mainStat": ["atkPct"] }],
"Amulet": [{ "name": "Death's Hold",        "itemId": 1760, "effectIcon": "TI_Icon_UO_Accessary_01", "mainStat": ["pen","critDmg"] }],
"Set":    [[{ "name": "Speed", "setId": "13", "count": 4 }]],
"SubstatPrio": [["atk"],["critRate"],["critDmg"],["spd"],["dmgUp"]]
```

Alignements garantis : `itemId` = `GearPiece.itemId` · `setId` = `armorSetId` du solver · clés stats =
**clés moteur canoniques** (`atkPct`, `pen`, `critDmg`, `critRate`, `dmgUp`…) dérivées du `GAME_STAT`
du solver, pas une heuristique. Couverture vérifiée : 89/89 recos, 1002 items, 354 sets, 0 non-matché.
`itemId`/`setId` peuvent valoir `null` si un nom diverge un jour → le traducteur doit le détecter et
le **logger** (pas filtrer silencieusement).

### À faire (gear-solver)

- [x] **Proxy Electron** — ✅ fait : `apps/desktop/src/reco-proxy.ts` (`proxyReco`) relaie
      `GET /api/reco/:id` → `OUTERPEDIA_API_BASE` (def. outerpedia.com), id numérique validé,
      timeout 8 s, status amont relayé verbatim (404 distinct), 502 sur échec transport. Branché
      dans `server.ts` (prod) **et** le middleware `vite.config.ts` (dev) → même route partout.
- [x] **Fetch côté renderer** — ✅ fait : `lib/reco/fetchReco.ts` → union discriminée
      `{ok|none|error}` (404 = pas de reco, distinct d'un échec réseau).
- [x] **Traducteur `reco → RecoFilterPatch`** — ✅ fait (`lib/reco/translateReco.ts`, 10 tests). Par build :
  - **mains** : `Weapon[].mainStat` / `Amulet[].mainStat` → `mainPicks.weapon` / `mainPicks.accessory`.
    Les clés sont **déjà** des clés moteur (`atkPct`, `pen`, `critDmg`) → assignation directe, pas de
    table. Plusieurs alternatives = OR-list (le `mainPicks` est déjà un OR au niveau slot).
  - **effets arme/accessoire** : `Weapon[].effectIcon` / `Amulet[].effectIcon` →
    `weaponEffectPicks[icon]="required"` / `accessoryEffectPicks[icon]="required"`. Le moteur traite
    `required` comme un **OR** au niveau slot (`engine.ts` `requiredEffects.has(icon)`), donc les
    amulettes alternatives (Death's Hold **ou** Clock Up) sont exprimables telles quelles. ✅
  - **sets** : `Set[[…],[…]]` mappe **1:1** sur le nouveau modèle `SetPlan[]` (cf. tâche dédiée
    ci-dessous) — chaque combo de la reco EST un plan (`[{setId,count}]`), la liste des combos = le OR.
    Plus d'aplatissement, plus de perte d'alternatives. **Dépend de** la généralisation `setPicks → setPlans`.
    L'import écrit directement `setPlans` (il n'a pas besoin de l'éditeur UI). `setId: null` → skip + warn.
  - **priorité substats** : `SubstatPrio` (tiers de clés moteur) → `priority: Record<key, number>`.
    Deux transformations : (1) clé moteur → clé priorité via `STAT_TO_PRIORITY` (`critRate`→`crc`,
    `critDmg`→`chd`, `effRes`→`res`, `dmgReduce`→`dmgRed`…), (2) rang du tier → poids décroissant dans
    l'échelle -1..3 du solver (ex. tier 0 → 3, 1 → 2, 2+ → 1). Clamp à la borne basse.
  - **`itemId`/`setId` null** → skip l'entrée + `console.warn` (mismatch nom à corriger côté data),
    ne pas planter le preset entier.
- [x] **Bouton + UI** — ✅ fait : « Get preset » dans le panneau Library (`RightSidebar`), lit
      `selected.charId`. État busy (« Fetching… »), ligne de statut (ok/warn/error) avec les warnings
      du traducteur, et `RecoBuildPicker` (modal Esc-dismiss) quand le reco a plusieurs builds nommés
      (1 seul → appliqué direct).
- [x] **Application au reducer** — ✅ fait : action `mergePreset` qui **overlay** le patch (mains
      weapon/accessory par-slot, effets/sets/priorité remplacés) en **préservant** options, héros exclus,
      stat/rating bands et topPct. `loadPreset` (remplacement total) reste pour les presets sauvés.
- [x] **Ignoré volontairement** : `Talisman` — non câblé (le solver optimise déjà les gems). Le
      traducteur ne touche pas au talisman, conforme.

---

## Tab Builds (`BuildsScreen.tsx`)

- [ ] 🟡 **`SlotMini` non cliquable** — aucun moyen d'inspecter une pièce depuis la tab
      Builds (tooltip/clic), contrairement à l'Inventory.

---

## Tab Inventory (`InventoryScreen.tsx`)

- [ ] **À vérifier EN JEU — Cap de Quality ne scale pas avec les étoiles** —
      `computeQuality` fixe `max = 14 + reforge.n` (14 = spread 4+4+3+3 d'une 6★), mais
      `SubstatRow` considère `isMax = s.lv >= stars` → une pièce 5★ plafonne ses subs plus bas
      → risque que les < 6★ soient classées "Poor"/"Decent" et écartées par le filtre Quality.
      **Confirmer en jeu** si le cap doit dépendre de `stars` (ne pas présumer).
- [ ] ⚪ **Optims mineures (si profilage)** — `computeQuality` recalculé plusieurs fois par
      pièce (précalculable dans `toUiPiece`) · double virtualisation (`contentVisibility:auto`
      redondant avec `react-virtual`) · 7 `useMemo` d'availability fusionnables en une passe.

> ✅ À NE PAS toucher : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` avec
> callback stable, re-seed du draft à l'ouverture de la modal.

---

## Desktop / Electron — Packaging (M7+)

> ⚠️ Le **plumbing est déjà écrit** (electron-builder `build`/`extraResources` dans
> `apps/desktop/package.json`, résolution `process.resourcesPath` dans `paths.ts`,
> `setupAutoUpdate()` dans `main.ts`, serveur local prod dans `server.ts`). Ce qui reste
> n'est donc PAS l'implémentation mais la **vérification end-to-end sur un vrai build packagé** :

- [ ] **Vérifier le bake prod du `data/`** — `extraResources` mappe `data/derived` →
      `process.resourcesPath` ; à valider sur un `electron-builder` réel (le dev passe par le
      Vite middleware, donc ce chemin n'a jamais tourné en packagé).
- [ ] **Vérifier l'`electron build`** — `pack`/`dist` existent ; produire un installeur et
      confirmer qu'il lance le serveur local + charge le renderer.
- [ ] **Vérifier l'auto-update** — `setupAutoUpdate()` est câblé (update-available/downloaded
      + `quitAndInstall`) mais **jamais testé contre une release signée + feed réels**.
- [ ] **Native capture button en packagé** — le serveur local (`server.ts`) sert déjà
      `/api/capture/*` en prod ; à confirmer que le bouton capture marche dans l'installeur
      (sans `npm run dev`).

---

## Persistence (M7)

- [x] **JSON import/export** — ✅ fait : section « Backup » dans Settings (export download
      `gear-solver-backup-YYYY-MM-DD.json` + import file-picker en mode **merge** dédupé par `id`).
      Module pur `lib/storage/transfer.ts` (`buildBackup`/`applyBackup`) opérant au niveau JSON
      brut → pas de re-conversion `Set` des presets ; clés `SAVED_BUILDS_KEY`/`FILTER_PRESETS_KEY`
      exportées comme source unique ; validation kind/version + 8 tests (`transfer.test.ts`).
- [ ] **Snapshot `data/` versioning** — chaque rebuild de `data/derived` devrait stamper un
      hash/timestamp pour invalider les caches localStorage après un patch jeu (les SavedBuild
      référencent des `pieceUids` qui peuvent disparaître).
- [ ] **Equip / Unequip** — nécessite une API jeu inexistante (supprimé du UI). À reprendre si
      on trouve un moyen d'envoyer des commandes au jeu (le pipeline de capture pourrait être
      étendu).

---

## Validation / régression (tests)

- [ ] **Test CP solver vs Builds** — comparer `calcBattlePower` sur le même build depuis les
      deux écrans, doit donner 0-diff.
- [ ] **Test mid-tree pruning** — fixture req-4pc Sharp + 1 helmet Sharp : le compteur de combos
      visités doit être strictement < combos sans prune.

---

## UX / UI (global)

- [ ] **Settings** — panneau pour les debug toggles + options globales (worker count override,
      topK/topN, heatmap on/off).
- [x] **Empty state** plus accueillant — ✅ fait (Builds) : roster vide → message dédié
      « No characters captured yet » (gear importé mais pas de roster → jouer jusqu'au lobby +
      reload) vs « No hero matches the current filters » quand c'est un filtre. `BuildsScreen.tsx`.
      *(Inventory garde « No piece matches… » — acceptable.)*
- [x] **Error boundary** React global — ✅ fait : `ScreenErrorBoundary` (class component) enveloppe
      la zone main dans `App.tsx`, `key={tab}` reset au changement d'onglet + bouton Retry. Un throw
      en render/`useMemo` affiche l'erreur au lieu de blanker l'app, la coquille (header/tabs) survit.

---

## Observabilité / debug

- [x] **Logging & debug un peu partout** — ✅ fait (renderer + desktop).
  - ✅ **Logger renderer** `lib/log.ts` : `debug(flag, …)` / `debugEnabled(flag)` gatés `gs.debug.*`
    (même pattern que `statLocks`), no-op zéro-coût quand off, taggé+coloré par flag.
  - ✅ **Solver** : `orchestrator.ts` logge le fan-out (pool, `chunkCount`, `maxPoolHit`, topK/topN,
    poolSizes) + la fin (merged/returned, durée ms, perm/searched par worker). Garde-fou
    `debugEnabled` avant de construire le tableau par-worker.
  - ✅ **Settings** : toggle « Solver fan-out logging » (`gs.debug.solver`) à côté du stat-lock.
  - ✅ **Footgun filtres** : `warnUnknownFilterKey` (cf. Solver, déjà livré).
  - ✅ **Capture / desktop** `apps/desktop/src/log.ts` : `dlog/dwarn` gatés sur l'env `GS_DEBUG`
    (`*`/`1`=tout, ou liste `capture,server`) — pas de localStorage en process Node. `dwarn` est
    **toujours-on** pour les échecs jusque-là avalés (stream I/O, fallback orphelin). Arrosé :
    lifecycle serveur (listen/EADDRINUSE fallback), spawn/exit capture, kill d'arbre orphelin
    (`taskkill /T`), `.mitm.pid` périmé, wipe (refus 409 / N supprimés), disarm au quit + timeout,
    app-ready + before-quit (main.ts), auto-update routé via `dwarn`.

---

## Livré

### Session 2026-06-25 (détail dans git)

**🔴 Correctness solver/UI** — recall filtre CP/upg appliqué in-loop (`a6aa67b`) · échecs
silencieux + `restoreBuild`/`solveError` (`2e6def2`) · allocation de gemmes affichée (`20d3ce9`) ·
bandeau projette les stats reforgées + badge (`8b1df0e`).

**🔴 Trous Builds** — bouton Optimize → câblé (`6f0617b`) · cohérence roster « N equipped · M
total » + label No gear (`b832c7b`) · `computeAdvice` règles data-driven (`7700456`).

**🔴 Inventory** — champ recherche restauré + incohérence `query`/trim réglée (`51a489e`).

**🟠 Perf solver** — workers idle cappés à la taille du pool (`35bf809`) · table de résultats
virtualisée + `memo(ResultRow)` (`197fc61`) · hoist `computeSetBonuses` hors boucle talismans,
bit-identique + 3 tests d'équivalence (`92e84ca`).

**🟠 Desktop robustesse** — mitmdump orphelin (taskkill /T), écran noir silencieux, crash I/O
serveur, `.mitm.pid` liveness, disarm non bloquant (`c0f039c`). **Sécu** — gardes Host/Origin sur
les POST, validation redirect `/img/*`, cap body stat-locks (`9f8fefe`).

**🟠 Perf Builds** — `useStatLocks` gaté sur debug + re-sort roster court-circuité (`87306fe`).

**🟡/⚪ Polish** — `useClickOutside` partagé (`5f6bb79`) · Inventory modal Esc+autofocus, détail
dérivé de `ui` (`4f0649a`) · Builds carte responsive + scroll `flex-1` + hygiène round1/NoteField/
type=button (`611c49f`) · footer Builder sur une ligne (`8203c25`) · doc-comments sets/preset
(`a46ba66`).

**Data** — split des BuffID EE séparés par virgule : 7 self-passifs droppés récupérés, dont le
+50% CHD d'Eris (`a6dfb16`).

**Docs** — passe de cohérence : data-schema, reference §1.2 (noms kebab-case + Archive),
STATUS, solver.md, roadmap, architecture (Electron), capture README.

### Antérieur (rappel — détail dans roadmap.md)

Solver M6.5 : cancel mid-solve (MessageChannel-yield) · panneau Library (Save/Remove build) ·
Exclude-equipped multi-select · colonne Upg · simulation de reforge · tri de colonnes. —
Persistence M7 : Save Build per hero (localStorage) · Filter presets per hero. — Tests :
solver-side stat-lock · gem override math · top-K heap. — Hygiene : suppression des stubs morts
`packages/core/src/solver.ts` et `score.ts`.
