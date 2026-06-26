# Changelog — livraisons gear-solver

> **Journal de ce qui a été livré** (le « suivi »). Les tâches **ouvertes** vivent dans
> [todo.md](todo.md) ; le détail commit-par-commit est dans l'historique git, et les jalons
> dans [roadmap.md](roadmap.md).

---

## Items de backlog clôturés (index)

### 🟠 Perf solver
- ✅ **Pruning par dominance (SOLVE CP)** — la CP étant monotone-croissante en chaque stat finale (et chaque
  stat finale en chaque entrée de bucket `flat/pct/buffPct`), une pièce dont la contribution est dominée
  composante-par-composante par une autre du **même slot + groupe** (set pour l'armure, effet pour
  arme/accessoire) ne peut jamais produire un build de CP supérieure → `pruneDominatedForCp` (`engine.ts`)
  l'élague du pool **avant le cartésien** (réduction multiplicative du nombre de combos). Ne compare que les
  axes de bucket réellement lus par `finalStatsFromBuckets` (CP-pertinents) sur les pièces **post-reforge**
  (le pool est déjà projeté). Désactivé si un filtre pourrait rendre un build à stats plus basses uniquement
  admissible (**borne max** sur une stat, ou **tout** filtre rating/cp/upg) ; les bornes min seules restent
  optimisées. Talisman/EE exemptés (gemmes issues de l'alloc globale + reroute de cap par-combo cassent la
  monotonie par-pièce). Exact au sommet du classement CP ; seuls des quasi-doublons strictement ≤ quittent la
  queue. +10 tests `dominance.test.ts` (drop strict, ties/Pareto/groupes gardés, reforge, équivalence top-CP
  end-to-end via `solveChunk`).
- ✅ **Accumulateur de buckets — re-sum déféré** — `aggregatePrefixBuckets` somme les 6 pièces
  invariantes (weapon..accessory) **1×/itération accessory** ; `computeFinalStatsFromPrefix` clone
  ce prefix et n'ajoute que talisman → EE → gemOverride → setBonuses, **dans l'ordre de slot exact**.
  Bit-identique (helpers `addPieceToBuckets`/`addGemOverride`/`addSetBonuses` partagés full/incremental).
  +4 tests d'équivalence (ee on/off × override on/off) + couvert par le test solveChunk 0-diff.

### 🟡/⚪ UX-cohérence & nits
- ✅ 🟡 **`noCrit` dans le scoring du solver** — `precomputeContext` lit `meta.noCrit` →
  `computeCheapRatings(fs, dmgStat, dmgSec, noCrit)` force `pCrit = 0` (le terme CHD disparaît, `mcd`
  retombe sur le hit non-crit). **CP laissé fidèle** (miroir 0-diff in-game). +4 tests `solver.test.ts`.
- ✅ 🟡 **`SlotMini` cliquable (Builds)** — hover sur une pièce équipée → `RichTooltip`
  (`placement="right"`) + `GearDetailBody` (panneau d'inspection complet, pas une version réduite).
- ✅ 🟡 **Conservation des résultats** — Builder reste monté (`display:none` quand inactif) :
  résultats / filtres / héros conservés + solve en fond. `initialHeroUid` consommé sur changement de prop.
- ✅ 🟡 **Reset des tris/filtres au lancement** — `useSessionState` (sessionStorage) : Inventory
  (tab/sort/dir/filters) + Builds (roster filters) session-scoped, remis au défaut au lancement.
  `gs.builds.notes` reste durable.
- ✅ 🟡 **Show/hide colonnes — clic-droit** — état `open` de `ColumnsMenu` remonté dans `ResultsTable` ;
  `onContextMenu` sur le `<tr>` d'en-tête `preventDefault()` + ouvre le menu.
- ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** (wontfix assumé) — placeholder faux quand aucun build
  n'est sélectionné, **laissé volontairement** pour ne pas diverger du panneau Inventory qui partage la
  map. À ne reprendre que si les deux maps divergent.

### 🟢 Features
- ✅ 🟢 **Rentabilité % vs Flat (subs)** — encadré « Sub tick value » (Builder) : par héros, la valeur
  d'un tick de sub 6★ en flat vs en %. Un tick % scale sur `base+evo+awak` (gear-indépendant) → verdict
  = fonction de la base. Dérivé `sub-ticks.json` (`subStatPools` outerpedia) ; `lib/subValue.ts` (+5 tests).
- ✅ 🟢 **Rentabilité dégâts par +1% (subs offensifs)** — encadré « Damage / +1% » : gain de dégâts pour
  +1% de chaque stat de scaling (ATK/DEF/HP/SPD via `dmgStat`+`dmgSec`) vs CHD vs DMG inc, **à 100% crit**.
  Réutilise `computeCheapRatings` (formules 1.4.9) ; `lib/dmgValue.ts` (+4 tests).

### Tests (fixtures lourdes)
- ✅ **CP solver vs Builds** — `solveChunk.test.ts` : `solveChunk` CP → `finalizeBuilds` → `computeFinalStats`
  + `calcBattlePower` recalculés indépendamment = **0-diff** (stats **et** CP) ; ratings différés recalculés.
- ✅ **mid-tree pruning** — pools A/B 2-par-slot, `req-4pc A` → 1 combo scoré (chemin all-A) vs 16
  brute-force ; cas insatisfiable → 0 combo, search élaguée. `SolveContext` hand-construit.

---

## Journal de session (Livré)

### Session 2026-06-26 — Snapshot data versioning (stamp + expo)

**Stamp de version des données dérivées** — `data/build.mjs` accumule un hash de contenu (`sha256` sur
nom+corps de chaque fichier dérivé, ordre fixe) et écrit `data/derived/version.json` `{ hash, builtAt }`.
Le `hash` est **stable tant que la donnée est inchangée** (un re-build no-op ne le bouge pas) → base d'une
future invalidation de cache ; `builtAt` est informatif. Renderer : `loadDataVersion()` (`data.ts`) +
ligne read-only « Game data version » dans **Settings → Data** (`SettingsModal`). **Invalidation des
caches localStorage différée** (compare le hash au boot + élague les SavedBuild aux `pieceUids` disparus —
touche la couche storage Builder-adjacente, cf. « Snapshot data versioning » dans Reste à faire).

### Session 2026-06-26 — Equip/Unequip : méthodes core + plomberie

**`equipItem` / `unequipItem`** — module pur `packages/core/src/equip.ts` qui réécrit un
`RawUserItem` capturé (champ `CharUID`, `"0"` = libre) : equip pose l'owner + **déplace** la pièce
qui occupait le même slot du perso (un slot = une pièce) ; unequip remet à `"0"`. Immuables (jamais
de mutation de l'entrée), no-op clone sur item inconnu / non-gear / déjà dans l'état voulu. +11 tests
`equip.test.ts`.

**Plomberie de persistance** — endpoint writer `POST /api/captured/user-item` (`server.ts` prod +
miroir dev `vite.config.ts`) qui valide `{ ItemList[] }` et `writeFileSync` `out/user_item.json`
(refus 409 si pipeline armé, mirror du wipe). Le **transform tourne côté renderer** (déjà core + game
data chargée) → serveur writer bête, **pas de couplage desktop→core**. Client `apps/renderer/src/equip.ts`
(`equipPiece`/`unequipPiece`) : fetch raw → core transform → POST. **Reste** : le déclencheur UI
(Builder/Builds) + vérif round-trip live (cf. « Equip / Unequip » dans Reste à faire, étape 3).

### Session 2026-06-26 — Builds advice (lot prioritaire) + dedup reforge budget

**`computeAdvice` extrait + enrichi** — sorti de `BuildsScreen` vers le module pur `lib/buildAdvice.ts`
(testable standalone, mirror `subValue`/`dmgValue`), +11 tests `buildAdvice.test.ts`. Règles ajoutées :
caps gaspillés (`crc`/`pen` > 100), gem slots vides sur Talisman/EE (+ tip « reach +5 »), upgrade agrégé
(reforges non utilisés + 6★ non ascensionné). Le budget de reforge n'est plus dupliqué : `maxReforgesOf`
**exporté depuis le solver** `engine.ts` (extrait de `simulateReforges`, comportement inchangé) et importé
par l'advice. `ComposedEntry` satisfait structurellement `AdviceInput`.

### Session 2026-06-26 — view-state session-scoped + optims Inventory

**Reset des tris/filtres au lancement** — `useSessionState` (sessionStorage) ajouté à
`hooks/usePersistedState.ts`. Inventory (tab/sort/dir/filters) + Builds (roster filters) session-scoped :
stables au switch d'onglet, réinitialisés au lancement. `gs.builds.notes` reste durable.
**Optims Inventory** — `contentVisibility:auto` retiré (résidu pré-virtualisation) + 7 `useMemo`
d'availability fusionnés en une passe sur `scopedForStats`.

### Session 2026-06-26 — 🔴 exclusion de pièce par set (pré-filtrage du pool)

**Pré-filtrage du pool armor par set requis + setting « Allow broken sets »** — quand les sets contraignent
**entièrement** l'armor (ex. `2pc A + 2pc B` ou `4pc A` → 0 slot libre), les pièces hors-set étaient
quand même énumérées. Désormais `armorSetWhitelist` (`setPlans.ts`, pur) calcule la whitelist de sets
admissibles et `precomputeContext` élague les pools helmet/armor/gloves/boots avant le cartésien
(énorme réduction sur les recherches sets-contraintes). Un set requis seul (`2pc A`, slots libres)
n'élague rien par défaut — il faut de quoi compléter. Nouveau toggle **Options → « Allow broken sets »**
(`SolverOptions.allowBrokenSets`, défaut **true** = comportement legacy) : à **false**, chaque pièce
d'armor doit appartenir à un set complété (2pc/4pc, pas de singleton ni de pièce set-less), ce qui (a)
restreint la whitelist aux sets *formables* (présents dans ≥2 slots armor) + requis, et (b) ajoute un
check leaf `allSetsComplete(setCount)` à la profondeur boots. Les slots verrouillés par **Keep current**
sont exemptés de l'élagage. Rétro-compat presets (`allowBrokenSets ?? true`) + payloads worker. +13 tests
`setPlans.test.ts` (`planSlots`, `armorSetWhitelist` 8 cas, `allSetsComplete` 4 cas).

### Session 2026-06-26 — onglet Home + panneau d'inspection partagé

**Home — nouvel onglet landing (update center + dashboard)** (ports « Home Directions » de Claude Design,
direction A) — onglet par défaut (`gs.tab` → `"Home"`). **(1) Update center** : carte inline pilotée par
état (uptodate / checking / downloading % / downloaded→Install / offline→Retry) qui **remplace les 2
dialogs natifs** ; auto-download dans le main process, le renderer poll `/api/update/status` et n'expose
que l'action restante (« Install new version »). Nouveaux : `apps/desktop/src/updater.ts` (state machine
electron-updater, `autoDownload=true`, `autoInstallOnAppQuit=false`), routes `/api/update/{status,check,install}`
(`server.ts`), miroir statique dev (`vite.config.ts`, ne peut pas importer electron-updater), `lib/update.ts`.
**(2) Dashboard** dérivé de l'inventaire/game déjà chargés (aucun fetch sauf le poll) : Account snapshot
(2×2, héros×★ à côté de Heroes owned) · Library · System health · Gear quality distribution (hero,
couleurs `QUALITY_COLOR` partagées avec le filtre Inventory, tooltip par tier) · breakdowns Roster
(icônes élément/classe réelles) + Gear (slots / top armor sets via `armorSetIcon` / tuiles
Ascended·+15·Locked). Empty state = CTA capture seule (la carte update reste). `App.tsx` : handler
`syncGameData`, props passées à `<HomeScreen>`.

**Panneau d'inspection partagé `GearDetailBody`** (`fc927ec`→`4f9d5b5`) — extraction du panneau gauche de
l'Inventory dans `design/GearDetail.tsx` (exporte `GearDetailBody`, `QUALITY_TONE`, `computeQuality`), pour
que d'autres surfaces rendent un détail **identique** sans dupliquer. `InventoryScreen` consomme l'export
(helpers locaux supprimés) ; la tab **Builds** inspecte les pièces équipées au survol (`RichTooltip` +
`GearDetailBody`). Au passage : **fix doublon de gems** (EE/talisman affichaient subs ET gems → désormais
`gemSlots ? GemPanel : subs`, mutuellement exclusif) + ajout du **passif Singularity** et du **passif
d'item**. `GearTooltip.tsx` (intermédiaire) supprimé.

**`RichTooltip placement="right"`** (`a1355d4`) — popover à droite du curseur (flip à gauche + clamp
vertical en 2 passes rAF) pour les listes denses où un tooltip au-dessus/dessous masque les voisins.

**Builder monté en permanence entre onglets** (`0d0ccde`) — plus de démontage à chaque changement
d'onglet (caché en `display:none`) : résultats / filtres / héros sélectionné conservés et un solve
continue en fond. `initialHeroUid` consommé sur changement de prop (plus seulement au mount).

**Lisibilité globale** (`87c2b94`) — sweep app-wide : plus de texte gris sombre illisible sur le fond
très foncé (bump des tons `muted`/`zinc` vers des valeurs lisibles).

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
