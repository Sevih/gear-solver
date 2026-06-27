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
  axes de bucket réellement lus par `finalStatsFromBuckets` (CP-pertinents), et tourne **en dernier** (après
  onlyMaxed / set / projection reforge / top-%) sur le **tableau de pool exact que le solve itère** : la
  preuve de monotonie porte sur les nombres composés, donc elle tient quel que soit le `reforgeMode` (stats
  capturées en `disable`, projetées au plafond en `classic`/`ascended`) et que `onlyMaxed` soit actif ou non
  — le mode change *quelles* pièces survivent, jamais la correction. Désactivé si un filtre pourrait rendre un build à stats plus basses uniquement
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
- ✅ 🔍 **Cap de Quality — vérifié en jeu (aucun changement)** — confirmé : la note se fait sur l'**investi**,
  pas sur le potentiel ni les étoiles. Un 6★ non reforge a un socle **4/4/3/3 = 14** ; reforge ×2 → noté sur 16.
  Donc `computeQuality` = `14 + reforges_faits` (`max = 14 + reforge.n`) est **correct** — rien à corriger.
  (A fait surgir un nit séparé : le tint doré `isMax = s.lv >= stars` a un mauvais seuil par-sub, cf. todo.)
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

### Session 2026-06-27 — refonte de la toolbar Builder (2 lignes, SOLVE fusionné, portrait)

La toolbar (héros + actions + filtres) tenait sur **une seule ligne** qui wrappait. Repassée en **2 lignes** dans
le même cadre : **ligne 1** = portrait du héros sélectionné (`CharacterPortrait`) + recherche + action SOLVE +
Filter ; **ligne 2** = Reforge / Maxed only + popovers de filtres + reset. Les boutons **SOLVE / SOLVE CP fusionnés**
en un **split button** `SolveButton` : le bouton principal lance le mode mémorisé, le ▾ ouvre un menu (Score /
Combat Power) — choisir un mode le mémorise **et** lance le solve. Mode persistant (`gs.builder.solveMode`, défaut
CP) ; pendant un solve le bouton devient Cancel. Typecheck + 188 tests verts.

### Session 2026-06-27 — log de confirmation codex + geas/quirk au disarm

`capture.ps1` confirmait l'inventaire + les héros, mais le **codex** (`/archive/info`) et les **geas/quirk**
(`/gift/info`) — capturés *après* sa sortie (pipeline armé, le joueur ouvre les écrans Codex/Gift) — n'avaient
aucune confirmation côté app. `disarm.ps1` décode et résume maintenant ces deux catchs (best-effort python,
streamé dans le log au clic Disarm) : `codex captured + decoded: N reward tiers (levels …)` /
`geas/quirk captured + decoded: N gift nodes`, ou un message « NOT captured — ouvre l'écran … puis disarm » si
le fichier manque.

### Session 2026-06-27 — talisman inclus dans le budget combos CP (cut du dernier multiplicateur)

Après le budget combos sur les 6 slots gear, le **talisman restait non-capé** (mesuré sur D.Luna : pools gear
10-14 mais talisman **68/68** → cartésien `~3,4M × 68 ≈ 230M`, ~20 s). Le talisman était exempté car ses gemmes
viennent de l'alloc globale — mais en mode CP **tous les talismans du même nombre de slots reçoivent le même delta
de gemmes**, donc ils ne diffèrent quasi que par leur **main (ATK flat)** : les dominés sont droppables. `ooparts`
est maintenant inclus dans `allocateComboBudget` / le CP-prune (candidat = aussi l'arg ooparts de `cpEval` pour son
ooBp ; pin du talisman courant). Le cartésien repasse sous le budget (~8M, ~1 s). EE toujours exempt (1 pièce).
Tests verts (188).

### Session 2026-06-27 — CSP stricte sur le serveur prod (warning Electron)

Electron râlait en console (`Insecure Content-Security-Policy` / `unsafe-eval`) parce que le renderer
n'avait aucune CSP. En dev c'est purement Vite (HMR via `eval`) et c'est inévitable ; en **prod**, le
serveur HTTP embarqué (`apps/desktop/src/server.ts`) sert maintenant le document HTML avec une CSP
serrée au plus juste de la surface réelle :
- `script-src 'self'` (build prod = scripts externes, zéro inline/eval) → **le warning disparaît dans la
  build packagée**.
- `style-src`/`font-src` ouvrent **Google Fonts** (Geist + Geist Mono) ; `'unsafe-inline'` sur les styles
  couvre les `style={{…}}` de React.
- `img-src` autorise `https://outerpedia.com` pour le **302 de secours** de `/img/*` (img-cache.ts) — la
  CSP re-vérifie la cible du redirect — plus `data:`/`blob:` (canvas/capture).
- Tout le reste (gamedata, captured JSON, API reco/update, solver worker) est same-origin → `'self'`.
- Durcissement : `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'none'`.

En-tête posé uniquement sur les réponses `text/html` (root + fallback SPA), seul document que la CSP régit.

### Session 2026-06-27 — cartes de gear Builder (gems, passifs singularité, extrapolation)

Lot de lisibilité sur la `BottomGearBand` (`GearCard`) :
- **Gems en double supprimés** — les cartes Talisman/EE affichaient les gemmes **socketées** (en tant que
  « substats ») **ET** l'allocation recommandée du build → bruit. Désormais une seule section **Gems** = les
  gemmes que le build pose : la reco du solver (badge **swap** si différente) ou, s'il n'a pas réalloué, les
  socketées (label **current**). `GemRecommendation` → `GemsSection`.
- **Passif Singularité +15 affiché + labellisé** — les pièces ascensionnées portent un passif +15 qui
  n'apparaissait pas sur les cartes (seul le `GearDetail` Inventory le montrait). Rendu via les entrées `main`
  `source === "singularity"`. **Distinction conditionnel/appliqué** : l'inconditionnel « DMG Increase to target »
  (`BT_STAT_PREMIUM/NONE`, `combatOnly:false`) compte dans le sheet → **ambre** ; les variantes conditionnelles
  (« vs Earth » `TARGET_ELEMENT`, « vs singularity buff » `TARGET_HAS_BUFF`, `combatOnly:true`) sont exclues du
  calcul → affichées **grisées + tag `cond`** avec leur propre libellé, pour ne jamais être prises pour des stats
  appliquées (le calcul/CP, lui, les excluait déjà via `if (s.combatOnly) continue` — vérifié, pas un bug calc).
- **Extrapolation plus claire** — quand une pièce est projetée (reforge classic/ascended), badge **▲ projected /
  classic / ascended** sur la ligne d'enhance (au lieu d'un badge discret « Substats »), valeur de main stat en
  **cyan**, substats teintés cyan. Tooltip explicite « re-scalé / reforgé vers cette cible, pas tes rolls actuels ».
- **Vérifié (pas un bug)** : le panneau **Projected** tient déjà compte des stats extrapolées — `precomputeContext`
  projette le pool (`projectPieceForReforge`) **avant** le solve, donc `build.finalStats` est composé sur les pièces
  projetées. Talisman/EE non projetés (gems), cohérent côté carte.

### Session 2026-06-27 — 🔴 sets conditionnels (lost-HP) faussement aplatis en stats flat

**Bug** : les sets « comeback » dont le bonus scale avec les **PV perdus du porteur** étaient distillés en stat
plate et appliqués **inconditionnellement à leur valeur MAX** → Swiftness (19) doublait la SPD (`floor(base·100/100)`,
d'où le build à 338 SPD repéré en jeu), Revenge (15) ajoutait **+160% ATK** et Patience (16) **+160% DEF**. Tous les
trois passent par un buff de Type `BT_STAT_OWNER_LOST_HP_RATE` (L1) / `_HALF` (6★), `StatType=ATK/DEF/SPEED`,
`Value=1600/1000` — la valeur au max de PV manquants, pas un bonus garanti. **Fix** (`data/build.mjs`,
`resolveSetEffectEntry`) : ces Types conditionnels renvoient désormais `p2/p4 = null` (aucun bonus numérique, comme
les sets-effet booléens type Immunity) ; la prose « proportional to missing Health » porte le sens côté UI. Le moteur
n'a pas de modèle de PV en combat, donc on n'estime rien plutôt que de gonfler. `sets.json` régénéré (sets 15/16/19
→ p2/p4 null). Impacte le stat-sheet, le solver (plus de sur-valorisation de ces sets) **et** la tab Builds. Tests
verts (stat-locks inclus → aucun héros locké n'utilisait ces sets).

### Session 2026-06-26 — SOLVE CP jouable par défaut (auto-prune CP-pondéré + garde-fou)

**Diagnostic (vrai compte)** — un SOLVE CP sans réglage tournait >100 s pour **2,4 milliards** de combos,
`S ≈ P` (quasi aucun élagage). Cause : le Top% prune était gardé derrière `hasPriority && topPct < 100`, et le
défaut (Top% 100, pas de priorité) le sautait → cartésien complet. Le dominance prune (exact) ne mord pas sur un
inventaire Pareto-divers (presque aucune pièce dominée sur **tous** les axes).

**Auto-prune CP-pondéré + budget combos** (`engine.ts`) — en **SOLVE CP sans priorité**, chaque slot est
désormais classé par **le CP qu'une pièce donne posée dans le build courant du héros** (`cpEval(computeFinalStats(
baseline, scaling, [autres pièces équipées, candidat]))`). Le baseline = les pièces équipées des autres slots → la
chaîne crit/pen/spd qui scale l'ATK est réaliste (un baseline mono-pièce sous-classerait l'ATK). C'est la **forme
*soft* du dominance prune** (classer par un scalaire CP au lieu d'exiger ≥ sur tous les axes). **Correctif clé** :
un *pourcentage* ne borne pas le **produit** — 30 %/slot laissait encore **1,25 G** combos (mesuré sur vrai compte,
>100 s). Le cap se fait donc par **budget combos absolu** : `allocateComboBudget` water-fill un nombre de pièces à
garder par slot pour que `∏ ≤ budget` (petits slots entiers, surplus vers les gros slots armor), puis `keepTopN`
garde le top-K CP. Budget défaut `CP_COMBO_BUDGET = 8 M` (~1 s), scalé par le slider Top% (`8M × topPct/30` ;
`100` = exhaustif). Priorité explicite prioritaire ; SOLVE Score sans priorité inchangé (prune sauté) ; Talisman/EE
+ slots `keepCurrent` exemptés ; sets requis préservés. **Limite assumée** : notation *standalone*, un membre qui
ne brille qu'en complétant un set peut être sous-classé (monter Top% ou exiger le set). `keepTopN` /
`allocateComboBudget` exportés + testés. +12 tests `cpPrune.test.ts`.

**Pin du build courant + debug CP** — suite : un solve rendait un CP **inférieur** au build équipé (le cap top-K
pouvait élaguer une pièce actuelle). `keepTopN` accepte des `pinUids` : la pièce **actuellement équipée** de chaque
slot est désormais **toujours gardée** → le build courant reste atteignable, donc le solver ne peut jamais rendre
pire que l'équipé. Plus un bloc **debug** (`gs.debug.solver`) dans `precomputeContext` qui loggue `cp-current-build`
= le CP que **notre moteur** calcule pour le build équipé (gems socketés) + la survie de chaque pièce au prune ;
l'orchestrator loggue `topCp`/`topScore` du meilleur résultat. Tranche **recall** (pièce élaguée) vs **calc** (notre
CP ≠ celui du jeu).

**🔴 Scoring de gemmes CP-aware (la vraie cause du CP < équipé)** — le debug l'a prouvé : `curCp = 315 492` (= le
jeu, notre calc est juste) mais `topCp = 292 530` avec **toutes** les pièces actuelles dans le pool. Cause : en
SOLVE CP sans priorité, `scoreGemPool` rankait les gemmes par **`value / norm` brut** (magnitude), pas par leur
apport CP → l'allocateur préférait des gemmes **dmg-reduce / flat** (gros chiffres, ~0 CP) aux gemmes **atk/crit/pen**
qui font le CP, et **baissait l'ATK** du build (9819 → 8919) donc le CP réel. Fix : `cpStatWeights` calcule un poids
CP par stat (= ΔCP d'un bump ROLL_NORM de la stat, évalué **au build courant** — une stat déjà à son cap CP, ex.
CRC ~100 %, retombe à ~0) et sert de priorité aux gemmes en mode CP. Priorité utilisateur explicite toujours
prioritaire ; SOLVE Score sans priorité inchangé (fallback gems socketés). `cpStatWeights` exporté + 2 tests
(offensif ≫ dmg-reduce, poids ≥ 0). Suite : core 22 + renderer 188 = 210.

**Défaut Top% 100 → 30** (`INITIAL_FILTERS`) — le slider garde son sens (100 = garde tout = exhaustif), mais le
défaut élague à 30 %/slot. Warning du panneau Priority corrigé (le Top% mord en SOLVE CP même sans priorité).

**Garde-fou cartésien** (`BuilderScreen`) — estime `∏ poolSizes` (post-prune ; les `poolSizes` arrivent dès le
départ du solve, avant la recherche réelle) et affiche un bandeau ⚠ au-dessus de `CARTESIAN_WARN` (50 M) qui
propose de baisser Top% / poser une priorité / exiger un set. Non-bloquant.

### Session 2026-06-26 — Timer de solve dans le footer Builder

**Durée du dernier solve affichée** — l'orchestrator mesurait déjà le wall-clock (`startedAt` →
flush) mais ne le loggait que sous `gs.debug.solver`. Il le remonte maintenant à l'UI : `onResult`
gagne un `durationMs`, `BuilderScreen` le stocke (`lastSolveMs`, remis à null au lancement d'un solve),
et le `FilterFooter` affiche **⏱ N ms / N.NN s** une fois le run fini (caché pendant `solving…`). But :
donner une mesure exacte de la vitesse du solver (au lieu de chronométrer à la louche) pour décider si
le SOLVE CP demande encore du travail. Aucun changement de la logique de calcul.

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
