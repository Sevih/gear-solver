# TODO — backlog gear-solver (consolidé)

> Backlog opérationnel unique. Le détail des items **livrés** vit dans
> l'historique git + la section « Livré » en bas (et [roadmap.md](roadmap.md)).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> **0 🔴 ouvert.** Le reste = 🟠 perf, polish 🟡/🟢/⚪, features, gros chantiers tests,
> « à vérifier en jeu » et la vérif packaging.

---

## Reste à faire

### 🟠 Perf solver
- [~] **Solver CP trop lent** — 2 optims du coût par combo livrées : **(a)** évaluateur CP préparé
      `makeCpEvaluator` (bonus star/skill/EE/fusion capturés 1×, plus d'allocation `CpArgs` ni de
      re-dérivation par combo, **bit-identique** + test d'identité) ; **(b)** cheap ratings **différés**
      au `finalizeBuilds` (top-N) en SOLVE CP quand aucun filtre de rating n'est posé (le heap trie par
      CP, les 8 produits ne servent qu'à l'affichage). **Reste** (levier structurel, le plus gros gain) :
      réduire le **nombre de combos** atteignant le CP — pré-filtre de pool plus agressif et/ou borne
      CP dérivée d'un upper-bound par slot pour pruner tôt. Demande un profilage sur vrai compte.
- [ ] **Accumulateur de buckets — re-sum déféré** — le hoist des set bonuses est fait ; reste le re-sum
      des 6+EE pièces par talisman. Gain marginal + **risque d'ordre flottant** (`incSet/decSet` casse la
      bit-identité, aucun test stat-locks ne rattrape une dérive ULP via `Math.trunc`). À faire en
      préservant l'ordre exact + test d'équivalence dédié.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) · **SharedArrayBuffer** pour le flag
      `cancelled` (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings`.

### 🟡/⚪ UX-cohérence & nits
- [x] 🟡 **`noCrit` dans le scoring du solver** — ~~`computeCheapRatings` (colonnes `dmg`/`dmgs`/`mcd`)
      suppose le crit du héros et surévalue un héros no-crit (Rhona / K.Tamamo / G.Nella).~~ Fait :
      `precomputeContext` lit `meta.noCrit` → contexte → `computeCheapRatings(fs, dmgStat, dmgSec, noCrit)`
      force `pCrit = 0` (le terme CHD disparaît) et `mcd` retombe sur le hit non-crit (pas de plafond crit
      à atteindre). **CP laissé fidèle** : `calcBattlePower` est un miroir validé 0-diff de l'in-game et
      SOLVE CP = « maximise le nombre CP du jeu » (qui inclut le crc tel quel) ; zéroter le crc divergerait.
      +4 tests `solver.test.ts`.
- [x] 🟡 **`SlotMini` non cliquable (Builds)** — ~~aucun moyen d'inspecter une pièce depuis la tab Builds
      (tooltip/clic), contrairement à l'Inventory.~~ Fait : hover sur une pièce équipée → `RichTooltip`
      (`placement="right"`) + `GearDetailBody` — le **panneau d'inspection complet** de l'Inventory
      (main/subs ou gems, qualité, passifs, sets, singularity), pas une version réduite.
- [x] 🟡 **Conservation des résultats** — le Builder **reste monté** (caché en `display:none` quand inactif)
      une fois ouvert, au lieu d'être démonté à chaque changement d'onglet (`App.tsx` : plus de
      `key={tab}` global, boundaries par écran, wrapper `h-full` pour la chaîne de hauteur). Donc résultats /
      filtres / héros sélectionné conservés **et** un solve continue de tourner en fond (le worker pool n'est
      plus `dispose()` au démontage). `initialHeroUid` consommé sur changement de prop (plus seulement au mount)
      pour que « Optimize » re-cible bien le héros maintenant que le Builder ne remonte plus.
- [x] 🟡 **Reset des tris/filtres au lancement** — ~~l'état persiste au reload et on n'en veut pas :
      Inventory persiste le tri (`gs.inv.sort`/`dir`/`tab`), Builds persiste ses filtres.~~ Fait :
      nouveau hook `useSessionState` (backend **sessionStorage**) dans `hooks/usePersistedState.ts`
      (factorisé avec `usePersistedState` via `useStorageState`). View-state basculé en session-scoped :
      Inventory (`gs.inv.tab`/`sort`/`dir`/`filters.v3`) + Builds (`gs.builds.filters`). Survit au
      remount lors d'un switch d'onglet (les écrans Home/Inventory/Builds remontent à chaque tab),
      mais repart au défaut au **lancement** (sessionStorage vidé à la fermeture de la fenêtre).
      `gs.builds.notes` (contenu utilisateur) reste durable en localStorage.
- [~] 🟡 **`Advices` (tab Builds)** — **lot prioritaire fait** : `computeAdvice` extrait dans le module pur
      `lib/buildAdvice.ts` (testable standalone, +11 tests `buildAdvice.test.ts`), branché par `BuildsScreen`.
      Nouvelles règles haute-confiance : **(4)** caps gaspillés `crc > 100` / `pen > 100` (waste arrondi, pas de
      « 0 % ») — `dmgRed > 70` **non fait** (seuil à valider en jeu) ; **(5)** gems — slots vides sur Talisman/EE
      (`gemSlots`, 5ᵉ slot gaté à +5) + tip « reach +5 » ; **(6)** upgrade agrégé — reforges non utilisés
      (`maxReforgesOf` **importé du solver** `engine.ts`, pas de formule dupliquée) + 6★ non ascensionné.
      Règles 4-6 ne tournent que sur un héros pleinement équipé (rule 1 early-return). **Reste** : (1) bruit
      Missing sur persos peu équipés · pièces non max-enhance (cap +N ambigu, à valider) · lot secondaire
      (main off-scaling vs `meta.dmgStat`, basse qualité, « 4pc dispo en inventaire » — nécessite l'inventaire complet).
- [x] 🟡 **Show/hide colonnes — accès clic-droit** — ~~le menu « Columns » existe (`c8808d4`) ; ajouter
      l'ouverture via clic-droit sur les en-têtes de colonne.~~ Fait : état `open` de `ColumnsMenu` remonté
      dans `ResultsTable` (contrôlé via `open`/`onOpenChange`) ; `onContextMenu` sur le `<tr>` d'en-tête
      `preventDefault()` + ouvre le menu. Le `useClickOutside` (mousedown, attaché seulement quand ouvert)
      ne ferme pas au clic-droit. Hints ajoutés (bouton + en-tête).
- [~] ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** (wontfix assumé) — placeholder faux quand aucun build
      n'est sélectionné (l'accessoire a un main user-sélectionnable), mais **laissé volontairement** pour
      ne pas diverger du panneau Inventory qui partage la map. À ne reprendre que si les deux maps divergent.
- [~] ⚪ **Optims mineures Inventory (si profilage)** — Fait : double virtualisation supprimée
      (`contentVisibility:auto`/`containIntrinsicSize` retirés des `GearTile` — `react-virtual` ne monte
      déjà que les lignes visibles + overscan, le CSS était un résidu de l'ancienne grille non-virtualisée) ·
      7 `useMemo` d'availability **fusionnés en une seule passe** sur `scopedForStats` (mains/subs/sets/
      classes/stars/rarities/qualities + `computeQuality` une fois par pièce au lieu d'une passe dédiée).
      **Reste** : `computeQuality` est encore recalculé dans `matchesFilters` (chip quality actif) et le
      panneau de détail — un précalcul partagé (`toUiPiece` / map par UID) traverserait la frontière
      adapter↔quality (calcul), différé tant que le profilage ne le réclame pas.

### 🟢 Features
- [x] 🟢 **Rentabilité % vs Flat (subs)** — encadré **"Sub tick value"** dans le Builder (entre current→projected
      et la library) : par héros, la valeur d'un tick de sub 6★ en flat ET en % (≈ équivalent flat), gagnant en
      cyan. Math : un tick % scale sur `base+evo+awak` (gear-indépendant — le flat gear est ajouté après le ×% ;
      le `(1+buffRate)` s'annule) → verdict = fonction de la base seule. Valeurs par tick = `subStatPools`
      d'outerpedia (`item-stats-detail.json`) → dérivé `sub-ticks.json` ; logique pure `lib/subValue.ts` (+5 tests).
      6★ : ATK 40/4% · DEF 40/4% · HP 73/3% (bascule vers % au-dessus de base 1000 / 1000 / 2433).
- [x] 🟢 **Rentabilité dégâts par +1% (subs offensifs)** — 2ᵉ encadré **"Damage / +1%"** : gain de dégâts
      attendu pour **+1%** de chaque stat pertinente (unité uniforme, pas le tick) — la/les **stat(s) de scaling
      du héros** (ATK/DEF/HP/**SPD** selon `dmgStat` + secondaires `dmgSec`) vs **CHD** vs **DMG inc**, classé, meilleur
      en cyan. Pour une stat de scaling, +1% = un sub 1% → `base × 1% × (1+buffRate)` (amplificateur par stat
      depuis `scaling.buffPct`) ; CHD/DMG inc = +1 point. Réutilise le modèle validé `computeCheapRatings`
      (crit/DMG±/PEN, formules 1.4.9) : bump +1% et recompare `.dmg`. **Calculé à 100% crit (crit cap)** —
      baseline endgame, sinon CHD est sous-évalué ; à 100% crit CHD ≡ DMG inc par point. Logique pure
      `lib/dmgValue.ts` (+4 tests). Ex. gros attaquant : 1% ATK ≻ CHD = DMG inc ; faible base : se resserre.

### À vérifier EN JEU
- [ ] **Cap de Quality ne scale pas avec les étoiles** — `computeQuality` fixe `max = 14 + reforge.n`
      (spread 6★), mais `SubstatRow` considère `isMax = s.lv >= stars` → une pièce 5★ plafonne ses subs
      plus bas → risque que les < 6★ soient classées "Poor"/"Decent" et écartées par le filtre Quality.
      **Confirmer en jeu** si le cap doit dépendre de `stars` (ne pas présumer).

### Persistence
- [ ] **Snapshot `data/` versioning** — stamper un hash/timestamp à chaque rebuild de `data/derived` pour
      invalider les caches localStorage après un patch jeu (les SavedBuild référencent des `pieceUids`
      qui peuvent disparaître).
- [~] **Equip / Unequip** — modifier les emplacements d'équipement sur les personnages (on n'envoie rien
      au jeu : on réécrit le JSON capturé `user_item.json`, champ `CharUID`). **Méthodes pures faites** :
      `equipItem(raw, game, itemUid, charUid)` / `unequipItem(raw, itemUid)` dans `packages/core/src/equip.ts`
      (immuables, déplacement du slot — un slot = une pièce, `"0"` = libre ; +11 tests `equip.test.ts`).
      **Reste à brancher** (déclenché depuis le solver/Builder) :
      1. **Endpoint d'écriture** `POST /api/captured/equip` `{ itemUid, charUid|null }` dans `server.ts`
         (lit `out/user_item.json`, applique `equipItem`/`unequipItem` avec la game data chargée pour le slot,
         `writeFileSync` — mirror du POST `/api/stat-locks` + `/api/capture/wipe`) ; miroir dev `vite.config.ts`.
      2. **Client renderer** `equipPiece`/`unequipPiece` (POST) puis `refreshInventory` (`App.tsx`).
      3. **Déclencheur UI** côté Builder/Builds (boutons / assignation par slot) → appelle le client + refresh.

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

### Session 2026-06-26 — Equip/Unequip : méthodes core

**`equipItem` / `unequipItem`** — module pur `packages/core/src/equip.ts` qui réécrit un
`RawUserItem` capturé (champ `CharUID`, `"0"` = libre) : equip pose l'owner + **déplace** la pièce
qui occupait le même slot du perso (un slot = une pièce) ; unequip remet à `"0"`. Immuables (jamais
de mutation de l'entrée), no-op clone sur item inconnu / non-gear / déjà dans l'état voulu. +11 tests
`equip.test.ts`. Le **branchement** (endpoint d'écriture disque + déclencheur Builder/Builds) reste
un todo dédié (cf. « Equip / Unequip » dans Reste à faire).

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
