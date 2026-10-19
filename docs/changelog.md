# Changelog — livraisons gear-solver

> **Journal de ce qui a été livré** (le « suivi »). Les tâches **ouvertes** vivent dans
> [todo.md](todo.md) ; le détail commit-par-commit est dans l'historique git, et les jalons
> dans [roadmap.md](roadmap.md).

---

## Items de backlog clôturés (index)

### ⚡ App et Worklist — badges mémoïsés, `equippedByHero` calculé une fois, journal linéaire, persistance hors des updaters (2026-10-19)
- ✅ **Pourquoi.** Item « Perf render App » et puces App / WorklistScreen de « Effets de bord dans des updaters
  `setState` » (`docs/todo.md`). Chaque rendu de l'App (donc chaque ligne du journal d'installation du plugin)
  reparcourait `inv.gear` pour le badge Builds et `remainingChangeCount` ; `equippedByHero` était reconstruit quatre
  fois par changement d'inventaire (réconciliation, réservations du solveur, badge Worklist, `WorklistScreen`) ;
  `setLog((l) => [...l, line])` recopiait tout le journal à chaque ligne (O(n²)) ; trois écritures localStorage
  vivaient dans des updaters `setState`, que StrictMode exécute deux fois.
- ✅ **Une map par inventaire.** `const equipped = useMemo(() => equippedByHero(inv), [inv])` dans `App.tsx`, passée
  à `reconcileWorklist`, `worklistClaims` et `remainingChangeCount` (`lib/storage/worklist.ts`, nouveau paramètre
  `equipped` dont la valeur par défaut la reconstruit — mêmes appels qu'avant pour les tests ; type `EquippedByHero`
  exporté) et à `WorklistScreen` (prop `equipped`, son `useMemo` disparaît). Badge Builds = `equipped.size` (les clés
  sont exactement les `equippedBy` non vides que comptait l'ancien `Set`) ; badge Worklist = `worklistRemaining`,
  `useMemo` sur `[worklist, inv, equipped]`.
- ✅ **Journal.** `pushLog` empile les lignes dans une ref et programme un seul `requestAnimationFrame` qui les verse
  d'un bloc (`setLog((l) => l.concat(batch))`) : au plus une mise à jour par frame, mêmes lignes dans le même ordre
  (y compris la ligne `[client] …` d'une erreur réseau). `clearLog` annule la frame en attente et vide le tampon au
  lancement d'une installation ; la frame est aussi annulée au démontage. `LogView` reçoit toujours un nouveau
  tableau à chaque lot, son défilement automatique ne change pas.
- ✅ **Persistance.** Petit hook local `usePersistOnChange(value, persist)` : écriture dans un effet quand la valeur
  change, la ref partant de la valeur chargée — rien n'est écrit au montage, ni deux fois en StrictMode. Les updaters
  deviennent purs : `toggleExclude` = `toggleExcludedPiece(prev, uid)` (identité stable conservée), ajout depuis le
  Builder = `[entry, ...prev]`, réconciliation = `reconcileWorklist(prev, inv, equipped).next` (même référence quand
  rien n'est appliqué, donc ni rendu ni écriture), et `WorklistScreen` reçoit `setWorklist` en `onChange` à la place
  de `commitWorklist`. Mêmes clés (`gs.worklist`, `gs.solver.excludedPieces`), mêmes données.
- ✅ **Garde de démontage.** `useMountedRef` dans `WorklistScreen.tsx` ; après `await equipAssignments(…)` (Apply all)
  et `await equipPieces(…)` (Apply locally d'une carte), `onAfterApply()` part toujours si l'écriture a réussi (le
  snapshot est réécrit même si l'utilisateur a changé d'onglet, l'App doit réimporter), puis l'état local
  (`applying`, message d'erreur) n'est touché que si le composant est encore monté — cas courant pour une carte : la
  réconciliation qui suit l'application la retire.
- ✅ **Tests (`apps/renderer/test/worklistPlan.test.ts`, +4).** Les trois fonctions donnent le même résultat avec la
  map passée et sans, sur un inventaire avec pièces équipées, un inventaire vide et `null` ; un cas vérifie qu'elles
  lisent bien la map fournie (réconciliation, réservations, compte, et une map vide qui fait tout recompter).
- ✅ **Vérifications.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` : core 154,
  desktop 131, renderer 489 verts (485 + 4), dernière ligne `Duration 1.03s (transform 2.24s, setup 0ms, import
  3.94s, tests 672ms, environment 5ms)` ; `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)`, sortie 0 (20
  avant). Les huit nouveaux sont tous sur `App.tsx` : avant ce lot le compilateur React abandonnait l'analyse du
  composant (seule la directive `eslint-disable` inutilisée de l'effet de synchro au démarrage remontait) ; il va
  maintenant au bout et signale sept `react-hooks/refs` sur du code inchangé (`refreshRef.current = …`,
  `followerRef.current` lu au rendu, `builderMounted.current` dans le JSX) et un `set-state-in-effect` sur l'effet de
  réconciliation, qui appelait déjà `setWorklist` dans un effet avant ce lot.
- ⏳ **Sevih contrôle** : Install plugin (journal qui défile, compteur « Show log (n) », lignes complètes à la fin),
  exclusion d'une pièce (droit-clic dans Inventory, survit au rechargement), ajout d'une entrée depuis le Builder puis
  Apply locally / Apply all dans la Worklist (badge, entrée retirée, pas d'avertissement React en console). Les
  avertissements `react-hooks/refs` de l'App sont hors périmètre (motifs de ref pendant le rendu à revoir à part).

### ⚡ Builder — filtres par héros lus une fois, progression isolée du rendu, diff build/équipement partagé (2026-10-19)
- ✅ **Pourquoi.** Items « Perf render Builder », puce « slot changé » de « Duplications » et puces Builder de « Effets
  de bord » (`docs/todo.md`). Pendant un solve, chaque tick de progression (~10/s, throttle de l'orchestrateur)
  re-rendait tout l'écran : `useRef(loadHeroFilters())` relisait et re-parsait sessionStorage à chaque rendu,
  `DmgPer1PctPanel` recalculait `dmgTickGains`, alors que seul le pied lit P / S. « Slot changé » était défini à trois
  endroits (`equipPlan`, `addToWorklist`, `pieceBySlot` du bandeau) avec trois règles.
- ✅ **Filtres par héros.** `const [initialHeroFilters] = useState(loadHeroFilters)` : une seule lecture au montage ;
  `heroFiltersRef` part de cette valeur et l'init paresseuse du reducer la lit (plus la ref pendant le rendu). Le
  changement de héros ne change pas (même `snapshotOnHeroSwitch`, même map mutée dans l'effet).
- ✅ **Progression.** `solveProgress` disparaît de l'état de l'écran : P / S passent par un petit store
  (`createSolveCountsStore`, `get`/`set`/`subscribe`, `set` sans effet si les compteurs n'ont pas bougé) que seul
  `FilterFooter` lit par `useSyncExternalStore` ; `livePoolSizes` reste un état de l'écran (bannière `emptyReason`,
  garde-fou `cartesianEstimate`) — l'orchestrateur renvoie le même objet à chaque tick, React n'y re-rend rien.
  `resetSolveProgress` (stable, `useCallback`) remplace les quatre remises à zéro. `DmgPer1PctPanel` mémoïse ses gains
  sur `comp` (calcul sorti dans `dmgPer1PctGains`, inchangé). **Mesure** (banc temporaire retiré avant le commit :
  `BuilderScreen` monté sous happy-dom, orchestrateur simulé, 50 appels `onProgress` après un clic sur Solve, compteur
  de rendus par composant) : avant 50 rendus de l'écran, 50 de `DmgPer1PctPanel`, 50 du pied ; après 2 rendus de
  l'écran (arrivée des `poolSizes`), 1 du panneau, 51 du pied.
- ✅ **`diffBuildVsLoadout` (`apps/renderer/src/lib/buildDiff.ts`, pure).** Pour chaque pièce du build : emplacement,
  pièce proposée, pièce portée par le héros à cet emplacement, `changed` = la règle de `upg` du moteur
  (`finalizeBuilds` : la pièce n'est pas équipée sur le héros aujourd'hui — `equippedBy` physique, pas les réservations
  Worklist). L'écran la calcule une fois (`buildDiff`, mémoïsé) ; `equipPlan` (moving / steal), `addToWorklist`
  (changements poussés, pièce remplacée) et le bandeau (pièce par emplacement, au lieu de son propre parcours de
  `pieceUids`) la lisent ; `currentLoadout` disparaît. **Divergences relevées** : aucune sur un cas réel — une pièce
  équipée sur le héros est forcément à son propre emplacement, donc `currentLoadout.get(slot)?.uid === uid` et
  `equippedBy === héros` disent la même chose, et une pièce réservée par la Worklist n'entre dans aucune des règles
  (toutes lisent l'`equippedBy` physique). Restent deux écarts théoriques avec le moteur : une pièce sans emplacement
  (l'ancien `equipPlan` la comptait, `addToWorklist` non ; le moteur ne peut pas la placer dans un build) et un uid
  absent de l'inventaire courant (build sauvegardé après la vente d'une pièce : `upg` le compte, la fonction l'ignore
  comme l'ancien `equipPlan`, rien à équiper).
- ✅ **Timers et effets.** « Added ✓ » de + Worklist et « Copied » de `CopyDebugButton` repassent à faux par un effet
  sur leur état, nettoyé au démontage. `filtersRef` et `selectedUidRef` sont synchronisés dans un `useLayoutEffect` :
  tous les effets de layout d'un commit passent avant ses effets passifs, donc l'effet de changement de héros lit
  toujours les filtres du rendu qui a changé de héros (ceux du héros sortant) — rien à garder pendant le rendu.
  `onClose` stables : `closeRecoPicker` (`useCallback`) pour `RecoBuildPicker`, `close` dans `EquipBuildButton` pour
  `EquipConfirm` ; leurs écouteurs Échap ne se réabonnent plus à chaque rendu.
- ✅ **Tests (`apps/renderer/test/buildDiff.test.ts`, 6).** Pièce déjà portée (inchangée, portée = elle-même), pièce
  portée par un autre héros (changée, pièce remplacée nommée, `equippedBy` de l'autre), emplacement vide, talisman et
  EE (clés `ooparts` / `exclusive`), nombre de `changed` égal au `upg` du moteur sur un build complet de 8, uid absent
  ignoré.
- ✅ **Docs suivies.** `docs/solver.md` / `wiki/Solver.md` (§ bandeau, « Diff par slot ») : pièce proposée, portée et
  « slot changé » viennent de `diffBuildVsLoadout`, plus de `currentLoadout`.
- ✅ **Vérifications.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` : core 154,
  desktop 131, renderer 485 verts (479 + 6), dernière ligne `Duration 1.03s (transform 2.54s, setup 0ms, import
  4.21s, tests 636ms, environment 4ms)` ; `npm run lint` : `✖ 20 problems (0 errors, 20 warnings)`, sortie 0 (24
  avant). Sur `BuilderScreen.tsx`, 11 → 7 : les trois `react-hooks/refs` (ref lue par l'init du reducer, `filtersRef`
  et `selectedUidRef` écrits pendant le rendu) et la directive `eslint-disable` inutilisée de l'effet d'estimation
  (désormais utile, `getOrchestrator` y lit le store) disparaissent ; restent cinq `set-state-in-effect`, le
  `react-hooks/refs` de `useClickOutside` et `incompatible-library` (TanStack Virtual).
- ⏳ **Sevih contrôle** : solve (P / S qui défilent dans le pied, bannière et garde-fou), Equip, + Worklist (« Added ✓ »
  puis retour), changement de héros pendant et après un solve (filtres du héros sortant gardés, entrant restaurés).
- ⏳ **Hors périmètre, vu en passant.** `useClickOutside` écrit `cb.current` pendant le rendu (même motif, non listé) ;
  dans `docs/solver.md` / `wiki/Solver.md`, le « liseré cyan + `← <pièce remplacée>` » du bandeau ne correspond plus
  aux cartes façon Inventaire (`ResultItemDetail`, depuis `aec694e`) ; l'en-tête `N slots change` lit `build.upg`,
  figé au solve (après un Equip et le ré-import, il garde l'ancien compte alors que les boutons passent à 0).

### 🎛️ Builder — filtres du solveur dans `lib`, `mergePreset` cohérent, `emptyReason` juste (2026-10-19)
- ✅ **Pourquoi.** Items « Dépendance inversée `lib → screens` », « `mergePreset` peut rendre les filtres
  contradictoires » et « `emptyReason` accuse l'EE » de l'audit (`docs/todo.md`). `filterPresets.ts` et
  `heroFilters.ts` importaient `SolverFilters` depuis l'écran de 4 600 lignes, où vivait un reducer sans aucun test ;
  une reco appliquée sur un set exclu le rendait requis ET exclu (0 build sans explication) ; un héros sans EE lisait
  « Exclusive: 0 pieces after filters » alors que le solve tourne sans EE.
- ✅ **Déplacement (`apps/renderer/src/lib/solver/builderFilters.ts`).** `SolverOptions`, `MinMax`, `SetChipReach`,
  `SolverFilters`, `ChipState`, `nextChipState`, `nextPlanCount`, `buildSolveFilters`, `INITIAL_FILTERS`,
  `SolverAction` et `solverFiltersReducer` sortent de `screens/BuilderScreen.tsx` tels quels (commentaires compris),
  exportés ; un en-tête de module en plus. `BuilderScreen.tsx`, `lib/storage/filterPresets.ts`,
  `lib/storage/heroFilters.ts` et `test/heroFilters.test.ts` (chemin d'import seul) l'importent ;
  `git grep -n "screens/" apps/renderer/src/lib` est vide. `SetChipState` et l'en-tête des chips restent dans l'écran
  (types de rendu). Le module importe `SlotId` de `design/tokens.ts`, comme `lib/buildAdvice.ts` déjà.
- ✅ **`mergePreset`.** Retire des `excludedSets` tout set présent dans les nouveaux plans de la reco (l'intention de la
  reco prime) ; les autres exclusions restent ; la docstring de l'action le dit.
- ✅ **`emptyReason` / table vide.** `emptyReason` ignore le slot `exclusive` (`engine.ts` pose `hit: ee ? 1 : 0`).
  `ResultsTable` reçoit `filteredOut` (des builds existent mais le « Filter » client n'en garde aucun) et affiche alors
  « No build passes the current filter. » au lieu de « Pick a hero and click SOLVE… », même style que ce dernier —
  le seul changement d'interface du lot.
- ✅ **Tests (`apps/renderer/test/builderFilters.test.ts`, 8).** `mergePreset` (set exclu puis requis → plus exclu,
  exclusion hors plans gardée ; mains d'un autre emplacement gardés, weapon remplacé ; reco sans plans → un plan vide
  et exclusions intactes) ; `cycleSetInPlan` (0 → 2 → 4 → 0, palier que l'inventaire ne peut pas former sauté, palier
  qui déborderait les 4 emplacements sauté) ; `resetAll` ; `loadPreset`. `filterPresets.test.ts` et
  `heroFilters.test.ts` verts sans retouche de fond.
- ✅ **Docs suivies.** `docs/solver.md`/`wiki/Solver.md` (arbre, § 4 « Les panneaux », état vide de la table) et
  `docs/reference.md`/`wiki/Engine-Reference.md` (arbre) placent le reducer dans `lib/solver/builderFilters.ts`.
- ✅ **Vérifications.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` : core 154,
  desktop 131, renderer 479 verts (471 + 8), dernière ligne `Duration 1.04s (transform 2.47s, setup 0ms, import
  4.08s, tests 638ms, environment 5ms)` ; `npm run lint` : `✖ 24 problems (0 errors, 24 warnings)`, sortie 0, les
  mêmes 24 qu'avant le lot (aucun dans le nouveau module). `git diff --stat` : `BuilderScreen.tsx` −300/+16, le gros du
  diff est le déplacement.
- ✅ **Hors périmètre, constaté.** L'arbre de `docs/solver.md` n'a pas la ligne `setPlans.ts` que `wiki/Solver.md` a.
- ⏳ **Sevih.** Contrôle à l'écran : un héros sans EE ne voit plus « Exclusive: 0 pieces » ; une reco appliquée sur un
  set exclu le rend requis ; un « Filter » qui vide la table affiche « No build passes the current filter. ».

### 🧹 Nettoyage — code mort, commentaires vers outerpedia-v2, `trust-buffs.json` plus chargé, `InvenType` retiré (2026-10-19)
- ✅ **Pourquoi.** Items « Code mort » et « Commentaires morts vers outerpedia-v2 » de l'audit, « `trust-buffs.json`
  chargé, jamais appliqué » et sa phrase dans « Règles du jeu recopiées à la main », puce `InvenType` de « Desktop »
  (`docs/todo.md`). Chaque symbole n'avait plus que sa définition ; aucun changement de comportement ni visuel.
- ✅ **Code mort retiré.** `addWorklistEntry`/`removeWorklistEntry`/`toggleWorklistChange`
  (`lib/storage/worklist.ts`, réimplémentés inline dans `App.tsx` et `WorklistScreen.tsx`) ; la valeur `"capture"` de
  `DebugFlag` (`lib/log.ts`, plus aucun `debug("capture", …)` depuis le retrait de l'émulateur) ; `equipPiece` et
  `unequipPiece` (`equip.ts`, l'import de `unequipItem` et sa mention dans l'en-tête suivent ; `equipPieces` et
  `equipAssignments` restent) ; `toIconPiece` (`design/adapter.ts`, les commentaires de `adapter.ts` et
  `EquipmentIcon.tsx` parlent d'un IconPiece construit inline) ; `statColor` (`design/tokens.ts`) ;
  `loadHeroPriority`/`persistHeroPriority` (`lib/storage/heroPriority.ts`, App passe par
  `usePersistedState(HERO_PRIORITY_KEY)`) ; l'option `allowZeroPriority` de `scoreGemPool` (`lib/solver/gems.ts`,
  `useRawFallback` et le `allowZeroPriority: false` explicite de `engine.ts` avec : SOLVE CP passe déjà les poids
  `cpStatWeights` en priorité).
- ✅ **`GearCard` (`screens/BuilderScreen.tsx`).** Les props « reserved for pimp » (`recommendedGems`, `reforged`,
  `reforgeMode`, `equippedSelf`, `equippedOther`, `hasEquipInfo`, `changed`, `replacesName`) sortent du type et de
  l'appel ; en cascade dans `BottomGearBand`, les locaux qui ne servaient qu'à elles (`equippedSelf`, `equippedOther`,
  `changed`, `replacesName`), les champs `reforged`/`currentPiece`/`changed` de `pieceBySlot` et les props `selfUid` et
  `currentLoadout` de la bande (le `currentLoadout` du Builder reste, `addToWorklist` le lit ; son commentaire ne renvoie plus à « l'accent de la bande »). `recommendedGems` reste un
  local : il habille toujours la pièce du talisman et de l'EE (`pieceForCard`). Le docstring « STEP 1 … pimp passes »
  sort. Conséquence : le « slot changé » de `pieceBySlot` n'existait que pour ces props, l'item « Duplications » de
  `docs/todo.md` passe de 3 à 2 définitions (`equipPlan`, `addToWorklist`).
- ✅ **Tests `allowZeroPriority`** (`apps/renderer/test/solver.test.ts`). « priority empty + allowZeroPriority=true → raw
  value/norm » supprimé (ne testait que l'option) ; « allowZeroPriority ignored when priority is non-empty » réécrit sans
  l'option (« a stat the non-empty priority leaves out scores 0 ») ; « end-to-end: SOLVE CP without priority yields a
  non-null delta » réécrit sur le chemin réel, une priorité en forme de poids CP (`{ atk: 1, dmgUp: 1 }`) ; les poids
  eux-mêmes sont couverts par `cpPrune.test.ts` (`cpStatWeights`). Un test de moins au total.
- ✅ **Commentaires outerpedia-v2.** Référence remplacée par la source actuelle du checkout `../outerpedia` quand elle
  existe : `design/EquipmentIcon.tsx` (tuile → `src/components/equipment/EquipmentIcon.tsx`, portrait →
  `src/components/character/CharacterPortrait.tsx`), `design/GameText.tsx` (`src/components/ui/GameText.tsx`),
  `design/Shell.tsx` (`data/generated/game-version.json`, l'URL de `game-version.ts`), `screens/BuilderScreen.tsx`
  (abréviations de `src/lib/stats.ts`), `packages/core/src/gamedata.ts` (`armorSetIcon` et `p2_desc` : datagen depuis sa
  vue des sets d'équipement ; `EnhanceData` : `datagen/generators/enhance.ts`). Provenance retirée, explication gardée,
  quand la source n'a plus d'équivalent direct : les étoiles de transcendance d'`EquipmentIcon.tsx` (outerpedia lit
  désormais `CharacterTranscendentTemplet` via `src/lib/transcendence.ts`, sans la table `stars.ts` recopiée ici) et le
  sprite `CT_Slot_Lock` de `screens/InventoryScreen.tsx` (servi par `apps/renderer/public`). `core/parse.ts`, cité par
  l'item, ne renvoie plus qu'à `src/lib/damage/item.ts` d'outerpedia, qui existe. Après : `git grep -n "outerpedia-v2"`
  hors docs ne trouve que `game-version.ts:3` et `test/gameVersion.test.ts:11` (dépôt archivé comme repli réel,
  gardés) ; restent dans `docs/design-prompt.md` (le brief d'origine, historique) et la note de suppression de
  `docs/reference.md`/`wiki/Engine-Reference.md`.
- ✅ **`trust-buffs.json` plus chargé.** `apps/renderer/src/data.ts` le retire du `Promise.all`, du test de nullité et de
  l'objet rendu ; `GameData.trustBuffs` devient optionnel avec une docstring (synchronisé avec le contrat, jamais chargé :
  buffs de combat) ; les fixtures de test gardent le champ. La synchronisation n'est pas touchée (`solver-files.json` le
  liste toujours, la liste du contrat appartient au lot CHECKOUT). `docs/reference.md` et `wiki/Engine-Reference.md`
  (tableau des tables dérivées) le disent. S'il sert un jour : la chaîne d'affinité par perso (une seule stat par héros),
  qu'outerpedia corrige côté site.
- ✅ **`InvenType`** sort de `RawUserItem` (`packages/core/src/raw.ts`, absent de `WSItemData` côté client) et des
  fixtures (`packages/core/test/parse.test.ts`, `equip.test.ts`, `unique-passive.test.ts`,
  `apps/renderer/test/eePassive.test.ts`).
- ✅ **Docs suivies.** `docs/reference.md`/`wiki/Engine-Reference.md` : le client d'équipement cite `equipPieces`
  (« Equip build », Apply locally) et `equipAssignments` (Apply all) au lieu de `equipPiece`/`unequipPiece` et d'un
  déclencheur « à câbler » ; le repli des gemmes en SOLVE CP ne parle plus de `allowZeroPriority`.
- ✅ **Hors périmètre, constaté.** `has4pc` est vivant (`nextPlanCount` et `SetsPanel` dans `BuilderScreen.tsx`,
  `lib/buildAdvice.ts`) ; `SourcePicker` n'existe plus depuis `0ef65f5` ; les deux sortent de la liste avec l'item.
- ✅ **Vérifications.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` : core 154, desktop
  131, renderer 471 verts (472 avant, le test de l'option seule en moins), dernière ligne `Duration 1.02s (transform
  2.31s, setup 0ms, import 3.98s, tests 666ms, environment 4ms)` ; `npm run lint` : `✖ 24 problems (0 errors, 24
  warnings)`, sortie 0, les mêmes 24 qu'avant le lot.
- ⏳ **Sevih.** Rien à faire : pas de changement visible, la prochaine release embarque le ménage.

### 🧰 Outillage — la release vérifie avant de publier, ESLint posé, `vite` retiré de `packages/core` (2026-10-19)
- ✅ **Pourquoi.** Items « `scripts/release.mjs` ne lance ni typecheck ni tests », « Aucun ESLint configuré », « `packages/core`
  déclare `vite` » de l'audit du 07/09 et puce « `release.mjs` ne restaure que `package.json` » de l'item « Desktop » de
  `docs/todo.md`. La release publiait sans rien vérifier (la CI ne couvre que les PR et `main`, pas les tables que
  `data/sync.mjs` régénère juste avant le build) ; un échec avant publication laissait `docs/release-notes.md` et
  `docs/changelog.md` tamponnés ; les six `eslint-disable-next-line react-hooks/exhaustive-deps` étaient inertes faute
  d'ESLint ; `vite` était déclaré en dependency d'un package TS pur qui ne l'importe pas.
- ✅ **Release.** `scripts/release.mjs` passe à 8 étapes (`step(n, …)` en `/8`, en-tête et renvois « step N » des
  commentaires renumérotés) : nouvelle étape 4 « Checks: typecheck + tests + lint » (`run("npm run typecheck")`,
  `run("npm test")`, `run("npm run lint")`) APRÈS `node data/sync.mjs` — les tests tournent sur les tables qui partent dans
  l'installeur — et AVANT `npm run desktop:build` ; un échec tombe dans le `catch` existant. Le tampon des journaux est
  réversible : `journalSnapshots` garde le texte des deux journaux avant `stampUnreleased`, et `restoreJournals` (même
  contrat que `restoreVersion`, n'écrit que si le texte a changé) les réécrit dans le `catch` tant que `releasedToGitHub`
  est faux. Le message de reprise manuelle (release déjà sur GitHub) indexe aussi `data/derived`, `docs/release-notes.md`
  et `docs/changelog.md`, comme l'étape 7. Non lancé (pas même `--dry-run`, `gh release view` est hors du garde) :
  `node --check scripts/release.mjs` vert et diff relu.
- ✅ **ESLint.** `eslint.config.js` (ESM, config plate, `defineConfig` + `globalIgnores`) : `@eslint/js` recommended,
  `typescript-eslint` recommended sans information de types (pas de `parserOptions.project`), globals navigateur pour
  `apps/renderer/src`, Node pour `apps/desktop`, `scripts/`, `data/*.mjs` et `*.config.ts` ; `eslint-plugin-react-hooks`
  par `reactHooks.configs.flat.recommended` (nom donné par le README du paquet en 7.1.1) sur `apps/renderer/**/*.{ts,tsx}`,
  `rules-of-hooks` en `error`, `exhaustive-deps` en `warn`. Ignorés : `**/dist/**`, `**/node_modules/**`,
  `apps/desktop/release/**`, `apps/desktop/resources/**`, `.cache/**`, `tools/**`, `wiki/**`, `data/derived/**`. Script
  racine `"lint": "eslint ."` ; CI : étape `npm run lint` après `npm run typecheck` (nom du job et commentaires suivis) ;
  `README.md` (§ « Testing, type-check & lint ») liste `npm run lint`, `docs/architecture.md` et `wiki/Architecture.md`
  disent les vérifications de la release avant publication.
- ✅ **Règles réglées dans la config.** Toutes les règles « compilateur React » du preset v7 (tout le preset sauf
  `rules-of-hooks` et `exhaustive-deps` : `refs`, `set-state-in-effect`, `static-components`, `purity`, `immutability`,
  `use-memo`…) en `warn`, leurs corrections relèvent des lots du renderer. `@typescript-eslint/no-unused-vars` garde
  `error` avec `argsIgnorePattern`/`varsIgnorePattern` `^_` et `ignoreRestSiblings` : 13 des 14 cas étaient des
  omissions volontaires (`const { a: _a, ...rest } = x` dans les tests, un paramètre `_label`), la convention du code.
- ✅ **Fichiers retouchés pour la lint** (mécanique, sans effet de comportement) : `apps/renderer/vite.config.ts`
  (import `existsSync` inutilisé retiré) ; `no-useless-assignment` sur trois valeurs initiales jamais lues —
  `apps/desktop/src/api-handler.ts` (`let removeBepinex: boolean;`, le `catch` répond et sort), `apps/desktop/src/main.ts`
  (`let hash: string | null;`, idem), `apps/renderer/src/design/GameText.tsx` (le dernier `pushPlain` n'affecte plus `k`,
  jamais relu) ; `no-empty` : `apps/renderer/src/capture.ts` (`catch { /* already released */ }` autour de
  `reader.releaseLock()`).
- ✅ **Warnings restants (24, `npm run lint` sort en 0).** `react-hooks/set-state-in-effect` 10 (BuilderScreen 5,
  SettingsModal 2, BuildsScreen 1, InventoryScreen 2), `react-hooks/refs` 6 (BuilderScreen 4, `hooks/usePersistedState.ts`
  2), `react-hooks/static-components` 3 (InventoryScreen), `react-hooks/incompatible-library` 2 (BuilderScreen,
  InventoryScreen), `react-hooks/exhaustive-deps` 1 (`BuildsScreen.tsx:655`, `lockedKeys` à mémoïser), et 2 directives
  `eslint-disable` désormais rapportées comme inutiles (`App.tsx:220`, `BuilderScreen.tsx:1069` : aucun problème de deps
  à ces lignes) — gardées comme demandé, les quatre autres sont actives.
- ✅ **Dépendances.** Les deux seules commandes npm autorisées pour ce lot :
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --save-dev --save-exact --no-audit --no-fund eslint@10.12.0 @eslint/js@10.0.1
  typescript-eslint@8.71.0 eslint-plugin-react-hooks@7.1.1 globals@17.13.0` (« added 79 packages », aucun pair refusé) et
  `npm uninstall --no-audit --no-fund vite -w @gear-solver/core` (« up to date », `vite` sort de
  `packages/core/package.json` et du lock). `package-lock.json` : 1202 insertions, 35 suppressions. Contrôle `node -e`
  entre `git show HEAD:package-lock.json` et le nouveau lock : 79 entrées ajoutées (la chaîne ESLint), aucune version de
  paquet tiers changée, `node_modules/vite` reste en 6.4.3 ; changent aussi l'entrée racine (devDependencies),
  `packages/core` (`dependencies` retirée), le drapeau `dev: true` sur 79 entrées (esbuild/rollup et 5 autres comme
  `@types/node`, que `vite` en dependency de core rendait « prod »), et deux restes d'un lock en retard sur l'arbre :
  `apps/desktop` 0.5.0 → 1.10.0 (la version réelle du `package.json`) et l'entrée `apps/web` (« extraneous », workspace
  disparu) retirée.
- ✅ **Vérifications.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` : core 154, desktop
  131, renderer 472 verts, dernière ligne `Duration 968ms (transform 2.14s, setup 0ms, import 3.68s, tests 596ms,
  environment 4ms)` ; `npm run lint` : `✖ 24 problems (0 errors, 24 warnings)`, sortie 0.
- ⏳ **Sevih.** Les 24 warnings restent aux lots du renderer (deps de hooks, règles compilateur) ; la prochaine release
  passera par l'étape 4 — un rouge y annule le bump et le tampon des journaux avant tout envoi.

### 🧪 Contrat — `GAME_STAT` tenu contre `stat-keys.json`, data:sync après C26 d'outerpedia (2026-10-19)
- ✅ **Pourquoi.** Item L6 de `docs/todo.md`. outerpedia émet depuis C26 (`f391a76e`) `data/generated/solver/stat-keys.json` :
  `{ [ST_*]: { [OAT_*]: { key, percent, abbr } } }`, la clé du vocabulaire du contrat (`atk`, `atkPct`, `chc`, `resRate`,
  `spdPct`…), la nature « % » (règle `CUtilUI.IsPercentStat` / `GetStatValue` du client, per-mille ÷ 10) et l'abréviation
  du wiki. Décision du 15/10 : gear-solver garde sa table contrat → moteur sous un test. `GAME_STAT`
  (`packages/core/src/stats.ts`) RESTE la table d'exécution : `resolveOption` et ses appelants ne changent pas, rien ne
  lit `stat-keys.json` à l'exécution. Une paire nouvelle chez outerpedia casse désormais la CI ici au lieu de disparaître
  du panneau en silence (ce qui arrive aux mains d'EE `ST_AVOID`).
- ✅ **Liste des tables.** `"stat-keys.json"` ajouté à `apps/desktop/src/solver-files.json` (liste unique depuis G12) :
  l'app le télécharge comme les autres mais ne le charge pas (`apps/renderer/src/data.ts` et `GameData` inchangés) ; le
  commentaire de `SOLVER_FILES` (`apps/desktop/src/data-sync.ts`) le dit, celui de `data/sync.mjs` aussi. Les « 19 »
  deviennent 20 : `apps/desktop/test/data-sync.test.ts` (« synced 20 tables », `size toBe(20)`), « other 19 artifacts »
  de l'en-tête de `data-sync.ts`, `docs/reference.md` § 3.1 et `wiki/Engine-Reference.md` § 3.1. `schema` reste 1 et
  `SUPPORTED_SOLVER_SCHEMA` ne bouge pas : un fichier ajouté n'est pas un changement de forme.
- ✅ **Table.** `CONTRACT_STAT_TO_ENGINE: Record<string, StatType | null>` exportée à côté de `GAME_STAT`, par CLÉ et non
  par paire (`dmgInc` et `dmgRed` portent les deux `OAT`) : `spdPct`→`spd` (le canal % de `resolveOption`), `chc`→`critRate`,
  `chd`→`critDmg`, `dmgInc`→`dmgUp`, `dmgRed`→`dmgReduce`, `eff`/`effRate`→`eff`, `res`/`resRate`→`effRes`,
  `cdmgRed`→`critDmgReduce`, les autres à l'identique, et `avoid`→`null` (combat-only, la précision par élément d'un main
  d'EE). L'en-tête du module dit les deux tables et le test qui les tient. Aucun désaccord de nature ni de clé entre
  `GAME_STAT` et le contrat : `GAME_STAT` n'est pas touché.
- ✅ **Test.** `packages/core/test/stat-keys.test.ts` sur `data/derived/stat-keys.json` (import JSON comme
  `set-level.test.ts`) : toute clé du fichier a son entrée dans `CONTRACT_STAT_TO_ENGINE` (couverture des clés, pas les 24
  lignes figées) ; pour chaque paire, `resolveOption({ st, ap, v: 10 }, 1)` rend `null` si la clé vaut `null`, sinon
  `{ stat, percent, value: percent ? 1 : 10 }` avec le `percent` du contrat ; au 18/10, 23 paires résolues et
  `ST_AVOID` / `OAT_ADD` à `null`. Les lignes de `GAME_STAT` qu'aucune paire ne porte (`ST_HIT_AP`, `ST_KILL_AP`) sont
  permises (commentaire). Échec forcé à la main (entrée `cdmgRed` retirée) : « contract key(s) cdmgRed unknown to
  packages/core/src/stats.ts: add the CONTRACT_STAT_TO_ENGINE entry (and the GAME_STAT row for its ST_*), or map it to
  null if it is not an engine stat », 1 failed | 25 passed ; table restaurée ensuite. Une paire inconnue de `GAME_STAT`
  échoue de même, avec le même conseil.
- ✅ **Données.** `npm run data:sync` (outerpedia à `2b7762a0`, propre et poussé) : « synced 20 tables », version
  `66681131bd9f` (built 2026-10-19T09:25:31.001Z). `git diff --stat data/derived` : `buffs.json`, `characters.json`,
  `enhance.json`, `sets.json`, `version.json` (5 files changed, 5 insertions(+), 5 deletions(-), JSON compact sur une
  ligne) plus `stat-keys.json` nouveau. Depuis le dernier sync (`7733858`) : A67 (`c905ef7f`) — `sets.json`, set 17
  niveau 2, `combatEffects.p4[0]` passe de `BID_ITEM_UO_SET_17` à `BID_ITEM_UO_SET_17_1`, `v` 700 → 500 (le 4P T4 de
  Pulverization à 50 %) ; B62 (`949cacd0`) — `enhance.json` gagne `gemSlots` et `reforge`, `buffs.json` marque
  `combatOnly` sur les 11 rangs de `BID_CEQUIP_MAIN_DMG_REDUCE_CORE` ; bestSkill (`2b7762a0`) — `characters.json`,
  2000057 (S1 burst 3, 2080 → 2672), 2000085 et 2000103 (burst retiré), 2000090 (S2 → S1). `game-client.json` inchangé.
- ✅ **Vérification.** `npm run typecheck` : vert (dernière ligne `> tsc --noEmit`, renderer). `npm test` : core
  `Tests  154 passed (154)`, desktop `Tests  131 passed (131)`, renderer `Tests  472 passed (472)` (dernière ligne) ;
  `apps/desktop/test/data-sync.test.ts` passe avec la liste allongée.
- ⏳ **Reste (Sevih).** Aucune release requise (rien ne change à l'exécution qu'un fichier de plus téléchargé). Hors
  périmètre, relevé en route : B62 émet aussi `progression.json` (`evoUnlockLevel`), absent de `solver-files.json` —
  le « exactement ce qu'outerpedia émet » du commentaire de `SOLVER_FILES` et les « 19 artefacts » de `docs/STATUS.md`
  ne tiennent plus (outerpedia émet 21 fichiers) ; à trancher avec l'item « Règles du jeu recopiées à la main ». Le main
  d'EE `ST_AVOID` affiché combat-only et l'abréviation du contrat dans l'interface restent à faire (L6).

### 🎯 Solver — plancher « Maxed only » au plafond de chaque pièce (2026-10-19)
- ✅ **Pourquoi.** Item « Plancher de « Maxed only » pour une pièce sous 6★ » de `docs/todo.md`, décision du 15/10
  (`a4cb02c`) : « Maxed only » veut dire « au plafond de la pièce ». Il attendait G2 (`d73e3ba`), qui a posé ce
  plafond pour la projection (`pieceReforgePlan`). Jusqu'ici `maxedFloorOf` rendait le plancher du MODE et
  `meetsMaxedFloor` l'imposait à toutes les pièces : une 5★ +10 R5 (son maximum) sortait d'un solve +10R6 que la
  projection tenait pour maxé, une 6★ non `unique` (pas d'élévation) sortait de +10R9 et +15R9 à +10 R6, son plafond.
- ✅ **Comment.** `maxedFloorOf` rend désormais le mode gaté (`Exclude<ReforgeMode, "disable"> | null`) et
  `meetsMaxedFloor(g, slot, mode, talismanMaxEnhance)` calcule le plancher de la pièce : `pieceReforgePlan(g, mode)`
  — enhance ≥ `ceiling.enhanceLevel`, reforges ≥ `budget` (`apps/renderer/src/lib/solver/engine.ts`). Talisman
  (enhance seul, borné à `enhance.maxEnhanceLevel`) et EE (enhance du mode, sans reforge) inchangés. Une pièce sans
  étoile (`star: null`, objet absent du contrat, budget 0 dans `pieceReforgePlan`) garde le plancher du mode : une
  pièce inconnue n'est pas « maxée » par défaut (commenté). Appelant unique `precomputeContext`, dont le commentaire
  suit. Textes : l'infobulle du bouton (`BuilderScreen.tsx`) ; `docs/solver.md` et `wiki/Solver.md` (filtre du pool
  et § Options) ; la ligne du tableau des tests (`docs/reference.md`, `wiki/Engine-Reference.md`) ; et
  `wiki/Using-the-App.md`, qui décrivait l'ancien plancher (pas d'équivalent dans `docs/`).
- ✅ **Tests.** `apps/renderer/test/solver.test.ts`, bloc « maxedFloorOf / meetsMaxedFloor » : les cas d'une 6★
  `unique` inchangés (le test passe le mode rendu par `maxedFloorOf`, corps intacts) ; 5★ en +10R6 : +10 R5 admise,
  +10 R4 et +9 R5 exclues ; 6★ non `unique` en +15R9 : +10 R6 admise, +10 R5 exclue ; 6★ `unique` +10 R6 en +10R9
  exclue ; talisman inchangé ; `star: null` → plancher du mode. Pool de bout en bout sur le vrai contrat
  (`apps/renderer/test/reforgeProjection.test.ts`) : `precomputeContext` en « Maxed only » +10R6, une arme 5★
  +10 R5 est dans le pool, à R4 elle n'y est pas. `npm run typecheck` : `tsc --noEmit` sans erreur (sortie 0) ;
  `npm test` : `Tests  472 passed (472)`.
- ✅ Hors périmètre, laissé : la projection (G2), les budgets 6/9 recopiés à la main, le mode « disable », les
  résultats affichés en « Maxed only » ; le compte « 95 tests » du tableau de `docs/reference.md` était déjà
  périmé, non retouché ; `docs/release-notes.md` (notes des versions publiées) non modifié.
- ⏳ Sevih : une note de version pour la prochaine release (« Maxed only » admet une pièce sous 6★ ou une 6★ non
  Unique à son propre plafond).

### 🔗 Synchro et contrat — mode CHECKOUT sans saut muet, une seule liste des tables, test de forme croisé, M3 testé ; todo remis à jour (2026-10-19)
- ✅ **Pourquoi.** Trois items de la section « Contrat solver » de `docs/todo.md` (Mode CHECKOUT, Test de forme
  croisé, M3), puis la remise à jour de ce fichier, en retard sur le code. Prérequis vérifié : le passif de cœur par
  palier de fusion (`corePassiveByFusion`, `76c37f3`) est commité. Pas de `data:sync`.
- ✅ **Mode CHECKOUT, une seule règle d'échec.** `syncGameData` (`apps/desktop/src/data-sync.ts`) copiait fichier
  par fichier : un artefact absent sautait par un `continue` muet, un illisible par un `catch` vide, et le statut
  disait quand même « synced N tables » — d'où un `data/derived` à moitié d'une version. Désormais les 18 tables
  sont lues et passées par `JSON.parse` AVANT toute écriture (`version.json` est le corps déjà lu pour le contrôle
  de schéma) ; un artefact absent, illisible ou non JSON → rien n'est écrit, `refused()` rend `error` « <fichier>
  is missing from / is unreadable in / is not valid JSON in the outerpedia checkout; keeping the cached data »
  (`unavailable` « …; no cached game data » sans cache) ; complet → les tables puis `version.json` en dernier,
  comme en REPO, « synced 19 tables (checkout <hash>) ». `data/sync.mjs` suit la même règle : il sortait en erreur
  sur un absent mais après avoir déjà réécrit les fichiers précédents de `data/derived/` ; il lit et parse tout
  d'abord (« missing artifact: … » ou « unreadable or not JSON: … », « data/derived left untouched », sortie 1),
  écrit `version.json` en dernier.
- ✅ **Une seule liste.** `apps/desktop/src/solver-files.json` (les 19 noms, à côté de `game-client.json`) est
  importé par `data-sync.ts` (`with { type: "json" }`, `SOLVER_FILES: readonly string[]`, même export) et par
  `data/sync.mjs` ; le « Keep in sync » et la copie disparaissent, les en-têtes des deux fichiers le disent. Les
  deux chemins d'import vérifiés : `tsc -p apps/desktop --outDir <scratch>` émet `solver-files.json` à côté de
  `data-sync.js`, le module compilé importé par Node rend `19 version.json` ; `loadConfigFromFile` de Vite charge
  `apps/renderer/vite.config.ts` et liste `../desktop/src/solver-files.json` et `../desktop/src/data-sync.ts` dans
  ses dépendances. Pas de repli sur des jumeaux. `files: ["dist/**/*"]` de l'installeur emporte le JSON émis, comme
  `game-client.json`. `docs/reference.md` § 3.1 / `wiki/Engine-Reference.md` : le mode checkout lit tout avant
  d'écrire ; le wiki disait que `data/sync.mjs` sort sur un artefact absent, il ajoute « or not JSON, before
  writing anything ».
- ✅ **Test de forme croisé** (`apps/renderer/test/contractShape.test.ts`, là où les tests cherchent déjà le
  checkout). Les clés de `StatBlock` et celles de `CharacterIngredients` (obligatoires et facultatives séparées, par
  `RequiredKeys` / `OptionalKeys`) sont déclarées `satisfies Record<…, true>` : une clé oubliée ou en trop ne passe
  pas `tsc` (essayé : `spdPct` ajouté → TS2353, `corePassiveByFusion` retiré → TS1360). Sur chaque personnage,
  chaque bloc (`classPassive`, `evoByLevel`, `skill8ByLevel`, `s1/s2/s3ByLevel`, `geasByNode.*.levels`,
  `corePassive` non nul) a exactement les 16 clés, `corePassiveByFusion` les 16 plus `spdPct` ; `ingredients` n'a
  que des clés déclarées et toutes les obligatoires. Vert sur `data/derived/characters.json` (129 personnages) et
  sur le checkout de ce poste : « outerpedia's data/generated/solver/characters.json » passé, non sauté (sans
  checkout, « (skipped: no outerpedia checkout found) »). Un quatrième cas prouve qu'il attrape une dérive (stat en
  trop, stat manquante, ingrédient non déclaré, ingrédient manquant). Lancé pendant qu'un lot d'outerpedia
  réécrivait `sets.json` et `version.json` de son `data/generated/solver/` ; `characters.json`, seul lu ici, n'y
  était pas touché.
- ✅ **M3 testé.** L'unique `IOT_STAT` de l'EE de Fatal (Eclipse, 2000078 : CHD +30 % à +10) est dans le contrat
  depuis C20 d'outerpedia et `parse.ts` le lit ; rien ne le tenait. `packages/core/test/parse.test.ts` (contrat
  réel : `ee-passives.json`, `enhance.json`, l'entrée d'`equipment.json`) : l'entrée du contrat est
  `{ levelThreshold: 10, ST_CRITICAL_DMG_RATE, OAT_ADD, 300 }` ; à +9 aucun main `eePassive` ; à +10
  `{ stat: "critDmg", value: 30, percent: true, fromBuff: true, source: "eePassive" }`.
  `apps/renderer/test/eePassive.test.ts` : fiche de Fatal composée (niveau 100), `computeFinalStats` → CHD
  inchangé avec l'EE à +9, +30 à +10. Rejeu du simulateur de client sur les 129 EE à +0/+1/+5/+9/+10 : tel quel,
  1 écart, 2000078 à +10, parce que son côté jeu ne compte que les buffs `IOT_BUFF` et liste les `IOT_STAT` à part
  (il nomme justement celui-ci) ; l'`IOT_STAT` compté côté jeu (`StatType ApplyingType OptionValue`) → 0 écart.
- ✅ **`docs/todo.md` remis à jour** (preuves) : L1 sort (fait par G1, `ba7d2c0`, `SUPPORTED_SOLVER_SCHEMA` et
  `schemaRefusal`) ; L10 sort (abandonné le 15/10, décision de Sevih : outerpedia est la source, gear-solver lit) ;
  « Filtre des passifs de skill trop strict » sort (fait côté contrat par outerpedia, B56, `feae32fe` « filtre
  client des passifs de competence ») ; C1 et M2 étaient déjà sortis (rien) ; « Externe — packaging desktop »
  devient « Externe — vérifs sur la version installée » et perd la puce « Bake prod du `data/` · installeur ·
  mise à jour automatique · bouton capture natif » : `extraResources` porte `../../data/derived`, `win.target`
  `nsis`, `apps/desktop/src/updater.ts` (`electron-updater`, `publish` GitHub) et les tags `v1.8.0` à `v1.10.0`
  existent, le « bouton capture natif » datait d'avant la source Steam ; « Capture no-root » et « Vérif sync repo
  en prod packagé » restent, inchangés ; Mode CHECKOUT, Test de forme croisé et M3 sortent ; « Dernier passage »
  daté du 19/10. `git diff --stat docs/todo.md` : `1 file changed, 6 insertions(+), 20 deletions(-)`.
- ✅ **Tests.** `apps/desktop/test/data-sync.test.ts` : CHECKOUT complet → `synced 19 tables (checkout h2)`,
  `copied: 19` ; chacune des 18 tables absente (`it.each` sur la liste partagée ; `version.json` exclu, sans lui
  le checkout n'est pas trouvé) → `error`, aucun fichier écrit, cache intact ; une table non JSON et une table
  illisible (un dossier à sa place) → idem ; absent sans cache → `unavailable`, dossier vide. `SOLVER_FILES` égale
  `solver-files.json`, 19 noms distincts. `data/sync.mjs` : chacune des 18 tables absente d'un faux checkout
  (rempli des octets mêmes de `data/derived/`, inoffensif même si le script écrivait avant d'échouer) → sortie non
  nulle, fichier nommé, `data/derived` identique ; une table non JSON → idem. Preuve que la liste partagée pilote
  les deux : `trust-buffs.json` retiré à l'essai de `solver-files.json` → `Tests  2 failed | 77 passed (79)` au
  lieu de 81 (un cas de moins dans chacun des deux `it.each`, le « 19 tables » des deux côtés rouge), fichier
  restauré. `npm run typecheck` : dernière ligne `> tsc --noEmit` (renderer), sans erreur ; `npm test` : core
  `Tests  128 passed (128)`, desktop `Tests  129 passed (129)`, renderer `Tests  467 passed (467)`.
- ✅ **Repéré hors périmètre** (rien touché) : `wiki/Engine-Reference.md` dit encore que `data/sync.mjs` cherche
  « a list of known local paths » (c'est `.env.local` puis `../outerpedia`) ; le reste de l'item « data-sync »
  (`derivedReady`, verrou, `writeAtomic`) n'est pas traité.
- ⏳ **`docs/roadmap.md` (M8, « Prod packagé encore à vérifier ») et `docs/STATUS.md` (« packaging … câblé mais
  non vérifié end-to-end »)** disent encore le packaging à vérifier : à requalifier comme la section du todo
  (Sevih).

### 🧹 Restes des lots G1 à G7 — `resVersion` des données, niveau de set de la fiche, famille du talisman conseillé, portrait fusionné, client de référence, Wipe refusé plugin actif (2026-10-18)
- ✅ **Pourquoi.** Sept restes notés par G1 à G7 dans leurs entrées (« ⏳ Laissé », « Repéré hors périmètre »),
  revérifiés le 18/10 ; sept parties indépendantes, un seul commit. Pas de `data:sync`.
- ✅ **`resVersion` des données chargées** (G1). `DataVersion` (`renderer/src/data.ts`) gagne `resVersion?`,
  facultatif : `loadDataVersion` ne le pose que s'il est une chaîne, un cache ancien sans lui charge toujours. Le
  stamp de Settings → Data l'affiche devant le hash (« game 1.11.408 · 79508390003b · built … ») ; l'en-tête
  (version en ligne) ne change pas. Le `hash` ne couvrant que les 18 tables, `data-sync.ts` gagne
  `refreshVersionStamp` : à `hash` égal (et sans `force`), le corps compacté de `version.json` est comparé à celui du
  cache et réécrit seul, atomique, s'il diffère — en CHECKOUT avant de répondre « fresh », en REPO avant
  d'enregistrer le SHA ; aucune autre table touchée, statut toujours `fresh`. En-tête du module, § 1.2 et liste des
  modes de `docs/reference.md` / `wiki/Engine-Reference.md`, étape 2 du cycle de `wiki/Data-Schema.md` mis à jour
  (`{ schema, resVersion, hash, builtAt }`).
- ✅ **Niveau de set de la fiche** (G3). `pickSetLevel` (`design/GearDetail.tsx`, exporté pour le test) lit
  `pieceSetLevel` de `@gear-solver/core` au lieu de `bt >= 4 ? 2 : 1` ; son repli (contrat sans
  `breakLimitCounts` → l'ancienne règle) vient avec, et la ligne la plus haute reste le dernier recours quand le
  niveau visé n'existe pas.
- ✅ **Talisman conseillé, toute la famille** (G4). `translateReco.ts` : `talismanFamilyKeys(equipment)` indexe une
  fois les talismans (`slot` `ooparts`) par `name` et rend, pour l'`itemId` conseillé, tous les `setId` de sa
  famille (Tactician's Charm 6★ 10207 → `3007`, `3018`, `3029, 3129`) ; `effectPicks` prend un résolveur à
  plusieurs clés, `translateRecoBuild` un troisième argument facultatif `resolveTalismanFamily` réservé au groupe
  Talisman (sans lui, l'ancien résolveur à une clé). Armes et accessoires inchangés. `applyRecoBuild`
  (`BuilderScreen.tsx`) le passe ; la note « None of the recommended talismans is owned » lit les clés du patch,
  donc teste la même famille. Les chips restent une par `setId` (hors périmètre). `docs/solver.md` /
  `wiki/Solver.md` et `wiki/Using-the-App.md` le disent.
- ✅ **Portrait et fiche du héros fusionné dans le Builder** (G5). La carte du héros choisi, les options de
  `HeroOption` et la liste des héros exclus prennent `effectiveCharacter(c, game?.characters)` (id du portrait,
  classe, élément, nom par `displayNameOf`), comme la carte Builds (`BuildsScreen.tsx` l.986-987). **Choix à
  relire** : le texte du champ du sélecteur (`selectedName` de `HeroSelect`) suit aussi, sans quoi il
  afficherait un autre nom que l'option choisie et la carte. `heroSearchHaystack` inchangé. Comparaison (lecture du
  code et du contrat, pas à l'écran) : Snow fusionnée (`fusionCharId` 2700003) → les deux écrans passent par
  `effectiveCharacter`, donc portrait 2700003, Ranger / Water, nom « Core Fusion Snow » ; avant, le Builder
  montrait le portrait 2000003.
- ✅ **Client de référence dans Settings** (G6). `steam-capture.ts` exporte `REFERENCE_CLIENT` (bloc `client` de
  `game-client.json` : `version`, `buildId`, `dumpedAt`) ; `SteamStatus` (et son miroir `renderer/src/steam.ts`)
  gagne `reference` et `buildDiffers` (build installé connu et différent). L'en-tête du volet Steam affiche « build
  <installé> · reference v1.4.18 (build 25744766) » (la référence seule sans build connu) et, si `buildDiffers`,
  une ligne ambre non bloquante « This game build differs from the client outerpedia last read (v1.4.18, build
  25744766). ». `wiki/Using-the-App.md` le mentionne.
- ✅ **Wipe refusé plugin actif** (G7). `POST /api/capture/wipe` (`api-handler.ts`) attend `steamPluginLive` et
  répond 409 `{ error: "Steam capture plugin live — close the game first" }`, comme le write-back de `user_item` ;
  dossier intact. `wipeCaptured` (`SettingsModal.tsx`) affiche l'`error` du serveur, « HTTP <code> » en repli.
  `wiki/FAQ.md`, `wiki/Capture-Pipeline.md`, `wiki/Using-the-App.md` le disent.
- ✅ **En-tête de `outerpediaCheckout.test.ts`** (G1) : il ne dit plus que le desktop n'a pas de lanceur de tests
  (`apps/desktop/vitest.config.ts` existe) ; fichier non déplacé.
- ✅ **Tests.** `data-sync.test.ts` : même hash et `resVersion` changé → `version.json` du cache réécrit, les 18
  autres tables toujours `{}`, en REPO (une seule requête CDN, SHA enregistré) et en CHECKOUT.
  `dataVersion.test.ts` (nouveau) : `resVersion` lu, absent → pas de plantage, sans `hash` → null.
  `gearDetailSetLevel.test.ts` (nouveau) : contrat réel BT3 → 1, BT4 → 2 ; `breakLimitCounts` modifié (niveau 2 à
  BT3) suivi ; contrat privé des champs → ancienne règle. `translateReco.test.ts` : Tactician's Charm 6★ → les
  trois `setId` de la famille, arme inchangée, talisman non résolu toujours averti. `talismanPreferred.test.ts`
  (moteur, `precomputeContext`) : seul un Tactician's Charm 5★ possédé → pool réduit à lui ; aucun membre → pool
  entier. `steam-status.test.ts` : référence dans le statut ; build égal → pas d'avertissement, différent →
  avertissement, inconnu → rien. `server-writeback.test.ts` : plugin actif → 409, `user_item.json` et heartbeat
  intacts ; inactif → dossier vidé. Compteurs de `translateReco` et `talismanPreferred` mis à jour dans le tableau
  § 3.3 de `docs/reference.md` / `wiki/Engine-Reference.md`. `npm run typecheck` : dernière ligne `> tsc --noEmit`
  (renderer), sans erreur ; `npm test` : core `Tests  125 passed (125)`, desktop `Tests  87 passed (87)`, renderer
  `Tests  461 passed (461)`.
- ✅ **Repéré hors périmètre** (rien touché) : le stamp de Settings → Data n'est lu qu'à l'ouverture du volet, une
  sync manuelle ne le rafraîchit pas ; la ligne « Total » du § 3.3 de `docs/reference.md` est déjà en retard sur
  le tableau (translateReco 10 contre 13 avant ce lot) ; `wiki/Roadmap.md` cite encore `version.json`
  `{ hash, builtAt }`.
- ⏳ **À regarder à l'écran** (Sevih) : Settings → Data (ligne game), Settings → Steam (référence, et
  l'avertissement quand le build installé n'est plus 25744766), le Builder sur un héros fusionné (carte, options,
  exclus), un Wipe jeu lancé avec le plugin (message du serveur).

### ⚔️ Effets de combat des sets (`combatEffects`) affichés à côté de la prose, jamais dans la fiche ni la CP (2026-10-18)
- ✅ **Pourquoi** (C1, second temps ; décision du 15/10 : retirer ces effets de la CP d'abord — fait en G3 —,
  les afficher ensuite). outerpedia (B53) émet dans chaque entrée `levels[]` de `sets.json` un champ
  `combatEffects: { p2, p4 }`, `null` sans effet `IOT_BUFF`, sinon une liste en enums bruts du jeu ; déjà
  synchronisé, aucun type ni écran ne le lisait. Huit sets n'ont que de la prose à l'écran (Fortification,
  Revenge, Patience, Pulverization, Immunity, Swiftness, Weakness, Augmentation) et rien ne disait au joueur que
  ces effets ne sont comptés ni dans la fiche ni dans la CP. Pas de `data:sync`.
- ✅ **Type** (`core/gamedata.ts`). `SetCombatEffect` exporté (`buffId`, `type`, `st?`, `ap?`, `v?`, `target`,
  `cond?`, commentés) et `SetLevel.combatEffects?: { p2; p4 }`, optionnel (un cache d'avant B53 ne l'a pas).
  `docs/data-schema.md` / `wiki/Data-Schema.md` le décrivent (paragraphe après les paliers de set : affichage
  seulement, jamais la fiche ni la CP) ; la ligne `sets.json` de `docs/reference.md` § 1.2 et de
  `wiki/Engine-Reference.md` le liste.
- ✅ **Étiquetage** (`renderer/src/lib/setCombatEffects.ts`, nouveau). `combatEffectLines(effects)`, pure : un
  libellé par `type` (`BT_DMG_REDUCE` « Damage reduction », `BT_DMG` « Damage dealt », `BT_DMG_TARGET_BREAK`
  « Damage vs Broken targets », `BT_IMMUNE` « Debuff immunity », `BT_STAT` le libellé court de la stat
  (`setBonusStatKey` puis `STAT[…].label`), `BT_STAT_OWNER_LOST_HP_RATE` / `_HALF` « <stat> by missing HP, up
  to » ; type inconnu → l'enum brut), puis `v / 10` % signé (signe moins typographique) quand `v` existe, puis
  « · enemies » quand `target` n'est pas `ME` ; `cond` n'est pas paraphrasé. `COMBAT_EFFECT_NOTE` porte la phrase
  fixe « Applies in battle only — not counted in stats or CP. ».
- ✅ **Affichage** (`design/SetCombatBadge.tsx`, nouveau). Une pastille « combat » (le style du badge `4pc` de
  `EffectRow`) après la prose ; son infobulle (`HoverCard`) : la phrase fixe puis une ligne par effet. Rien pour un
  palier sans effet de combat. Dans `GearDetail`, `SetEffectRow` prend `combat` (la ligne du niveau de la pièce,
  `combatEffects.p2` / `.p4`) ; un palier d'effet sans prose montre la pastille seule au lieu du tiret. Dans
  `BuildEffectsPanel` (`BuilderScreen.tsx`), les lignes 2-pc / 4-pc suivent `row2` / `row4` de `wornSetRows` (rien
  pour un 2P effacé) et une ligne existe désormais aussi pour un palier d'effet sans prose. **Choix à relire** : le
  contenu de cette carte est déjà une infobulle (`HoverCard`, `pointer-events-none`), une infobulle imbriquée n'y
  serait jamais survolable ; la pastille y est donc posée en mode `expanded`, le texte de son infobulle écrit
  dessous. Palier sans effet de combat : même DOM qu'avant (`SetCombatBadge` rend `null`, la prose passe par le même
  `GameText`) — comparé à la lecture du code pour Attack et Speed, pas à l'écran.
- ✅ **Calcul inchangé**. Aucun calcul ne lit `combatEffects` (grep) ; test de garde
  (`apps/renderer/test/setCombatEffects.test.ts`) : fiche (`computeFinalStats`) et CP (`calcBattlePower`) d'un build
  Pulverization 4P (BT 4 et BT 3) puis Weakness 2P (BT 4 et BT 0) identiques avec le vrai `sets.json` et le même
  privé de `combatEffects`.
- ✅ **`wornSetRows`** (`core/set-level.ts`). La branche « 2P d'effet de combat effacé par le 4P » lit
  `row4.combatEffects.p4 != null` quand le champ existe, `p4_desc` en repli commenté (cache d'avant B53) : la règle
  `CreateBuffSetItem` de l'en-tête de `datagen/generators/solver.ts` d'outerpedia. En-tête du module et § 2.6 de
  `docs/reference.md` / `wiki/Engine-Reference.md` le disent. Zéro écart : test d'équivalence
  (`packages/core/test/set-level.test.ts`) sur le contrat réel, `drop2` identique avec et sans `combatEffects` pour
  les 306 sets et toutes les combinaisons de 2 à 4 pièces de BT0 à BT4 ; les lignes `ignoreLowSet` restent
  Fortification L2, Penetration L1, Speed L1, Bursting L1. Plus un cas construit : 4P d'effet sans prose → 2P
  retiré, prose sans effet → gardé.
- ✅ **Tests.** `combatEffectLines` : Weakness L2 → « Damage reduction −35% · enemies », Immunity L1 → « Debuff
  immunity », Fortification L1 → « Damage reduction +40% » et « SPD −30% », Revenge L2 → « ATK by missing HP, up
  to +160% », Pulverization L1, type inconnu → enum brut. `npm run typecheck` : dernière ligne `> tsc --noEmit`
  (renderer), sans erreur ; `npm test` : core `Tests  125 passed (125)`, desktop `Tests  79 passed (79)`, renderer
  `Tests  450 passed (450)`.
- ✅ **Prose et données qui divergent** (signalé, rien touché) : Weakness, la prose dit « Increases damage dealt
  against targets inflicted with a debuff by 25 % / 35 % », la donnée est un `BT_DMG_REDUCE` −250 / −350 posé sur
  `ENEMY_TEAM` sous `OWNER_HAS_BUFF` ; Pulverization L2 4P, la prose dit 50 %, `combatEffects.p4` porte 700
  (70 %, le même buff `BID_ITEM_UO_SET_17` que le 2P). La pastille montre la donnée.
- ✅ **Hors périmètre, vu en passant** : `pickSetLevel` de `GearDetail.tsx` choisit encore le niveau par `bt ≥ 4`
  et non par `breakLimitCounts` (même résultat aujourd'hui) ; le catalogue de sets du Builder et
  `buildAdvice.ts` lisent toujours `p4_desc` pour savoir si un 4P existe.
- ⏳ À l'écran : le panneau Effects d'un build Pulverization 4P (2-pc et 4-pc, pastille et texte dessous), le
  détail d'une pièce Weakness (pastille, infobulle au survol), celui d'une pièce Attack (inchangé).

### 🗡️ Uniques d'arme et d'accessoire de la fiche lus du contrat (`statsByTier`), vitesse en taux de l'équipement (2026-10-18)
- ✅ **Pourquoi** (M2, livré sur la preuve par le code, décision du 15/10). Deux passifs uniques touchent la fiche
  et n'étaient pas comptés : Phantasm Necrosis (arme, set 1021 : objets 24, 174, 324, 474, 624, 774,
  92201-92203, 93391-93393, `ST_SPEED OAT_RATE −300` caché aux cinq paliers) et Briareos's Ambition (accessoire,
  set 2033 : 1797, 93291-93293, `ST_BUFF_RESIST OAT_RATE` 200 → 400 du palier 0 au 4). Une fiche à 220 SPD avec
  Phantasm restait à 220 au lieu de 154 et « Max CP » pouvait élire l'arme à tort. La donnée était déjà synchronisée
  (`equipment-passives.json`, `statsByTier` à côté de `textByTier`, C20 d'outerpedia) mais rien ne la lisait : pas
  de `data:sync`. Règle du client : buff pris au niveau 1 + breakthrough, versé au taux de buff (`BuffValueRate`)
  de la stat, comme le passif de noyau.
- ✅ **Type** (`core/gamedata.ts`). `EquipmentPassive.statsByTier?: Array<Array<{ st; ap?; v }>>`, optionnel,
  commenté (index = breakthrough, valeurs brutes, ‰ signé). `docs/data-schema.md` / `wiki/Data-Schema.md` le
  décrivent (puce de la main stat et paragraphe à côté des paliers de set) ; la ligne `equipment-passives.json` de
  `docs/reference.md` § 1.2 et de `wiki/Engine-Reference.md` aussi.
- ✅ **Parse** (`core/parse.ts`). `parseGearPiece`, pour une arme ou un accessoire, lit
  `statsByTier[min(BreakLimitLevel, longueur − 1)]`, résout chaque entrée par `resolveOption` et la pousse dans
  `main` en `fromBuff: true, source: "uniquePassive"` (nouvelle valeur de l'union `RolledStat.source`, commentée dans
  `core/types.ts`). Une entrée sans `ap` serait ignorée : il n'y en a aucune dans le contrat. Sans `statsByTier`,
  mains inchangées ; la projection au plafond (`projectMainToCeiling`) ne touche pas ces mains (`source` ≠ `option`)
  et garde le breakthrough, donc le palier.
- ✅ **Affichage.** `adapter.ts` écarte `uniquePassive` comme `eePassive` (commentaire du tri par `source`) : le
  texte du passif dit déjà « Reduces Speed of the wielder by 30% ». Le catalogue des mains du Builder
  (`BuilderScreen.tsx`) et le filtre de main du moteur (`engine.ts`) ne gardent que `option` : rien à changer.
- ✅ **Calcul** (`composeBuild.ts`). La RES en taux d'un `fromBuff` arrive déjà dans `buffPct.effRes`, lu par
  `composeMultStat` en `gearBuffPct` : prouvé par un test, rien changé. La vitesse en taux n'avait pas de canal
  (`buffPct.spd` est du plat, main de l'EE `ST_SPEED OAT_ADD 40`) : `addPieceToBuckets` route un `fromBuff` en %
  de `spd` vers `buffPct.spdRate`, et `finalStatsFromBuckets` l'ajoute au taux du héros posé par G8 avant l'unique
  `applySpdRate` : `trunc(total × (1000 + héros‰ + équipement‰) / 1000)`. `computeFinalStatsFromPrefix` passe par
  les mêmes fonctions (test d'équivalence au bit près vert). `spdRate` entre dans `CP_RATE_KEYS` (`engine.ts`) ;
  l'en-tête de la dominance dit pourquoi la monotonie tient : taux du héros ≥ 0, seul taux négatif d'équipement
  −30 % sur l'unique arme, somme > −1000 ‰, et la vitesse croît avec le taux à total ≥ 0.
- ✅ **Textes.** `docs/reference.md` § 1.3 (nouvelle source, puce de convention), § 1.5 (point 3 : canal
  `buffPct.spdRate`, RES par `gearBuffPct`) et § 2.1 (paragraphe SPD, qui disait « le passif de noyau seul »), miroirs
  dans `wiki/Engine-Reference.md`.
- ✅ **Tests.** `packages/core/test/unique-passive.test.ts` (contrat réel) : armes 24 et 93391 aux breakthrough 0
  et 4 → une main `uniquePassive` SPD −30 % ; 1797 → RES +20 % au 0, +40 % au 4 ; breakthrough 7 → dernier palier ;
  Surefire Greatsword (754, sans `statsByTier`) → mains identiques avec et sans la table ; les 16 objets du contrat
  sont des armes ou accessoires et produisent tous une main. `apps/renderer/test/uniquePassive.test.ts` : le taux
  dans `buffPct.spdRate` et pas dans `buffPct.spd` ; fiche à 220 SPD → 154 ; Snow fusionnée lv100 (149 + 45 SPD
  plats) avec Phantasm → `trunc(194 × 743 / 1000)` ; chemin incrémental identique au complet (Phantasm, Briareos,
  EE plat) ; dominance : de deux armes identiques sauf le taux, celle à −30 % est éliminée dans les deux ordres,
  jamais l'autre ; `toUiPiece` ne l'affiche ni en main ni en effet ; Briareos au breakthrough 4 sur RES 150 →
  `composeMultStat(res, 0, 0, 40)` = 210. CP (`calcBattlePower`, fiche de test ATK 3000 / DEF 800 / HP 8000 / CHC 60
  / CHD 180 à 220 SPD) : 36 135 sans l'arme, 31 371 avec, soit −4 764 (l'écart croît avec l'ATK, d'où les ~8 000 de
  l'item sur une fiche plus offensive). Rejeu des passifs uniques qui entrent dans la fiche (lecture seule de
  `outerpedia-gamedata/parsed` et `data/derived`) : 10 lignes, 5 d'arme (`BID_ITEM_UO_WEAPON_21`, niv. 1 à 5,
  12 objets) et 5 d'accessoire (`BID_IRREGULAR_UO_ACC_05`, niv. 1 à 5, 4 objets), toutes couvertes par un
  `statsByTier` lu ici, mêmes valeurs ; aucune ligne de talisman. `npm run typecheck` : dernière ligne `tsc --noEmit`
  (renderer) sans erreur ; `npm test` : dernière ligne `Tests  440 passed (440)` (core 121, desktop 79).
- ⏳ Rien à faire pour les talismans au rejeu (aucune ligne). Hors périmètre, vu en passant : `priorityScoreOf` et
  `magnitudeScoreOf` (`engine.ts`) somment toutes les mains non combat, `uniquePassive` compris, contre
  `ROLL_NORMS` (le −30 % de Phantasm pèse comme −30 SPD plats, −1,5 jet, dans le classement Score sans CP) ; même
  traitement déjà pour `singularity` / `eePassive`. À trancher si le pré-tri du mode Score doit l'ignorer.

### ⚡ Passif de cœur au palier de fusion capturé, vitesse du noyau en taux dans les deux compositeurs (2026-10-18)
- ✅ **Pourquoi.** `composeCharStats` ajoutait `ingredients.corePassive` (un seul bloc, au niveau max) à tout
  fusionné quel que soit son palier : Notia en fusion 1 à 4 recevait EFF +50 %. Et la vitesse en taux du noyau
  (Snow / Lisha fusionnées, +4,3 %) arrivait cuite en plat (+6 / +5) : Snow lv1 / 20 / 40 (LB0) à 139 / 142 / 145
  contre 138 / 141 / 144 en jeu, et le taux ne touchait jamais la vitesse de l'équipement (+40 SPD plats → 195 au
  lieu de 197). La règle du client (`CSkillManager.Create`, `CFormula.CalcFinalStat`) : Skill_23 au niveau du palier
  de fusion, et la vitesse en taux entre dans `BuffValueRate`, qui multiplie la vitesse entière (base, évolutions,
  équipement) avec troncature. La donnée était déjà dans le contrat (`corePassiveByFusion`, B56 d'outerpedia, hash
  `79508390003b` identique des deux côtés) : pas de `data:sync`.
- ✅ **Types** (`core/gamedata.ts`). `CharacterIngredients.corePassiveByFusion?: Record<string, StatBlock & { spdPct
  }>`, optionnel (cache d'avant le 16/10) ; `corePassive` devient optionnel lui aussi (le format 2 le retire) et son
  commentaire dit qu'il n'est plus lu qu'en repli. `docs/data-schema.md` et `wiki/Data-Schema.md` décrivent le
  champ, à côté des paliers de set.
- ✅ **Palier** (`core/compose-stats.ts`). `ComposeOptions.fusionLevel` ; `pickCoreBlock` prend la clé du palier,
  la plus haute quand le palier est absent ou 0 (même repli « max-everything » que les niveaux de compétence), zéro
  pour une clé introuvable ; sans `corePassiveByFusion`, l'ancien `corePassive` exactement comme avant, vitesse
  cuite comprise (commenté). Les trois appelants (`engine.ts` `precomputeContext`, `BuildsScreen`, `BuilderScreen`)
  passent `fusionLevel: <héros>.fusionLevel` ; l'oracle du wiki ne le passe pas (couche `full` = palier 5, dit dans
  son commentaire).
- ✅ **Vitesse en taux, une seule règle.** `applySpdRate(total, ratePct)` (core) = `trunc(total × (1000 + taux‰) /
  1000)`, total renvoyé tel quel à taux nul. Le compositeur expose `scaling.spd = { value, buffPct }` (vitesse avant
  taux, somme des `spdPct` de la fiche — aujourd'hui le noyau seul) et `noGearStats.spd = applySpdRate(value,
  buffPct)`. Côté équipement, `finalStatsFromBuckets` (donc `computeFinalStats`, `computeFinalStatsPlusRoll` et
  `computeFinalStatsFromPrefix`) part de `scaling.spd.value`, ajoute plat, EE et set % comme avant, puis applique
  le taux une fois au total : le `noGearStats.spd` déjà multiplié que reçoivent les appelants en `baseline` n'est
  plus lu pour la vitesse, et les appelants n'ont rien à recalculer. `ScalingMap.spd` est optionnel (une carte
  construite à la main dans les tests retombe sur `baseline.spd`, taux 0), `intrinsicStats.spd` inchangé. La
  vitesse de set reste `floor(base × pct / 100)` (item « Mineurs de fiche ») sur la vitesse avant taux, et le taux
  multiplie le total qu'elle produit. L'en-tête de la dominance (`engine.ts`) dit pourquoi la monotonie tient (taux
  au-dessus de −100 %, aujourd'hui ≥ 0) ; `spd` était déjà dans `CP_RATE_KEYS`.
- ✅ **Contrat, règle (b).** `SUPPORTED_SOLVER_SCHEMA` passe à 2 dans `apps/desktop/src/data-sync.ts` et
  `scripts/solver-schema.mjs` ; le commentaire dit ce qu'est le format 2 (`corePassive` retiré,
  `corePassiveByFusion` seul). Les tests de `data-sync.test.ts` qui prenaient 2 pour « plus récent » passent à 3,
  le schéma 2 est lu (REPO et CHECKOUT), les deux jumeaux acceptent 2 et refusent 3.
- ✅ **Textes.** `docs/reference.md` § 1.4 (point 7 et sortie `scaling.spd`), § 1.5 (point 3 : la vitesse n'est plus
  additive simple quand un taux existe), § 2.1 (paragraphe SPD) et leurs miroirs de `wiki/Engine-Reference.md`,
  dont la ligne de `compose-stats.test.ts` de son § 3.3 (« known divergence » n'existe plus ; `docs/reference.md`
  § 3.3 n'a pas cette ligne, laissé tel quel).
- ✅ **Tests.** `packages/core/test/compose-stats.test.ts` : le `describe` « known divergence » devient un accord
  avec `clientCalcFinalStat` (Snow 138 / 141 / 144 / 148 aux lv1 / 20 / 40 / 60 LB0, égal à lv100 LB0, lv120 LB3 et
  à tous les niveaux) ; la garde des données vérifie que seuls 2700003 et 2700005 portent un `spdPct` et qu'aucun
  bloc de noyau ne porte de vitesse plate (et lit les blocs par palier) ; Notia lv100 : EFF 170 sans le +50 % aux
  fusions 1 et 4, 255 à la 5, palier 0 ou absent = 5, palier inconnu = zéro ; Lisha 124 à tous les niveaux ; un
  fusionné sans `corePassive` (format 2) compose à l'identique ; aucun non-fusionné n'a de taux ; repli sans
  `corePassiveByFusion` épinglé sur les chiffres d'avant ce lot (Snow 139 / 142 / 145 / 148 / 155 / 163, autres
  stats inchangées ; Notia EFF 255 même en fusion 1). `apps/renderer/test/coreFusionSpeed.test.ts` (nouveau) :
  Snow fusionnée lv100 + 40 SPD plats → 197, sans équipement = la vitesse no-gear, Lisha 124 à tous les niveaux,
  `computeFinalStatsFromPrefix` identique au bit près au chemin complet avec taux (EE `fromBuff` comprise), héros
  sans taux = somme d'aujourd'hui. Restent verts sans retouche : `core-fusion-captures.test.ts` (Snow lv100 155),
  les stat-locks, les équivalences « set-bonus hoist » et accumulateur incrémental de `solver.test.ts`,
  `coreFusion.test.ts`. Comparaison ancien / nouveau compositeur sur toutes les fiches (options par défaut, lv1 / 50 / 100 / 120) :
  seule Snow fusionnée bouge.
  `npm run typecheck` : dernière ligne `> tsc --noEmit`, code 0 ; `npm test` : `Tests  116 passed (116)` (core),
  `Tests  79 passed (79)` (desktop), `Tests  432 passed (432)` (renderer).
- ✅ **Oracle du wiki** (`npm run oracle:wiki -- --out` vers un dossier temporaire, comparé à
  `../outerpedia/src/lib/data/fixtures/gear-solver-oracle.json`) : trois lignes changent, toutes Snow (2700003),
  couche `full`, vitesse lv1 139 → 138, lv20 142 → 141, lv40 145 → 144. Lisha identique (124 = 119 + 5 =
  `trunc(119 × 1,043)`), Notia identique (palier max).
- ⏳ **Côté outerpedia (Sevih)** : la fiche du wiki (`src/lib/data/char-progression.ts`, `sheetPassives` et
  `blockToParts`, `docs/TODO.md` d'outerpedia l.62-66 et l.76-79) et la régénération de la fixture de l'oracle ;
  son test d'oracle reste vert tant qu'elle n'est pas régénérée. Puis l'étape (c) — retrait de `corePassive`,
  `schema` 2 — seulement une fois publiée la release de gear-solver qui porte ce lot.
- ⏳ Hors lot : M5 (niveaux de compétence des fusionnés), vitesse de set et autres mineurs de fiche, uniques
  d'équipement (G9, qui ajoutera le taux de vitesse de l'équipement au même `applySpdRate`), version et release.
  Rin (2700019) et Eliza (2700035) n'ont ni `corePassive` ni `corePassiveByFusion` : sans noyau, comme avant.

### 🗑️ Capture — retrait de la source émulateur, Steam et import manuel seulement (2026-10-16)
- ✅ **Décision de Sevih du 16/10** : le jeu étant sur Steam, tout le pipeline émulateur part (retiré, pas
  désactivé). Restent deux entrées de données : le plugin BepInEx du client Steam et l'import manuel de fichiers
  (« Manual fallback »), sans changement de comportement pour l'un comme pour l'autre.
- ✅ **Supprimés** : `tools/capture/` en entier (`capture.ps1`, `disarm.ps1`, `addon.py`, `cert/c8750f0d.0`,
  `scripts/bind_cert.sh`, `scripts/redir.sh`, README), `apps/desktop/src/emulator-detect.ts`, `mitm-provision.ts`,
  `capture-ca.ts`, `apps/desktop/test/capture-ca.test.ts`, `apps/renderer/src/emulator.ts`, `.gitattributes` (ses
  deux règles visaient les `.sh` poussés par adb et l'addon Python : plus aucun fichier de ce type).
- ✅ **Desktop.** `api-handler.ts` perd `/api/capture/run`, `/api/capture/disarm`, `/api/emulators`,
  `/api/preflight`, `/api/capture/manual-device`, `streamPs`, `isArmed`, `captureRunArgs`, `readJsonBody` et les
  champs `captureDir` / `manualDevice` / `bundledAdb` / `captureScriptArgs` / `prepareCapture` d'`ApiConfig` ;
  `/api/capture/status` rend `{ captured, userItemMtime }` (le suiveur Steam s'en sert toujours) ; le Wipe ne
  connaît plus de 409 « armed » et le write-back `POST /api/captured/user-item` n'est plus refusé que plugin Steam
  actif (inchangé). `server.ts` perd `captureScriptArgs` et `disarmIfArmed` ; `main.ts` ferme simplement le serveur
  au `before-quit`. `paths.ts` perd `CAPTURE_DIR`, `BUNDLED_ADB`, `CAPTURE_CA_DIR`, `MANUAL_DEVICE`. `download.ts`
  (`downloadVerified` / `expandZip`) reste, il sert à BepInEx.
- ✅ **`CAPTURE_OUT` reste** : le plugin Steam y écrit (`OutDir`) et l'import le relit. En dev il quittait
  `tools/capture/out` (dossier supprimé) pour `.cache/capture-out` (`paths.ts` et `vite.config.ts`, déjà ignoré
  par `.cache/`) ; packagé, `<userData>/capture-out` ne bouge pas.
- ✅ **Nettoyage au lancement** (`apps/desktop/src/legacy-cleanup.ts`, appelé par `main.ts` à chaque démarrage,
  sans effet une fois fait) : supprime `<userData>/capture-ca/` (la CA générée par S1, clé privée comprise).
  `capture-out/` sert encore à Steam, il reste ; seuls les fichiers propres au pipeline y partent (`.mitm.pid`,
  `mitm.log`, `mitm.log.err`, `game.flows` — ce dernier peut contenir tout le trafic, en-têtes compris). Au-delà de
  la liste du lot, et pour la même raison : `<userData>/bin/mitmproxy/` (le `mitmdump.exe` téléchargé, que des
  antivirus classent PUA) et `<userData>/manual-device.json`. Un fichier verrouillé est sauté et retenté au
  lancement suivant ; chaque suppression est loggée.
- ✅ **Renderer.** `CaptureSource` et `CAPTURE_SOURCE_KEY` disparaissent de `steam.ts` : plus de préférence de
  source, `gs.capture.source` n'est plus lu, donc une valeur `"emulator"` déjà sauvée se lit comme Steam sans
  message (idem `gs.debug.captureFlows`). Le suivi des snapshots tourne toujours (plus de garde
  `source === "steam"`). Sans Steam installé, l'app montre ce qu'elle montrait déjà à un utilisateur Steam sans
  jeu : « OUTERPLANE not found in Steam » sur Home, le Manual fallback en bas de fenêtre ; le texte de l'étape 1 du
  wizard et l'infobulle du badge renvoient à cet import au lieu de « switch the source ». Settings : plus de
  sélecteur de source (`SourcePicker`), plus de `SetupPane` à quatre étapes, `ManualDeviceSection`,
  `CurrentStepCard`, `ReadyCard`, copies par marque ni option Debug `game.flows` ; Setup = le wizard Steam seul.
  Header : plus d'`EmulatorBadge` ni Arm/Disarm, `CaptureControls` = les contrôles Steam. Home : CTA et carte
  santé Steam seuls, pastille Live/Idle. Textes ajustés : description et confirmation du Wipe (plus de
  `game.flows` ni de « blocked while armed »), état vide d'Inventory, messages 409 du Builder et du Worklist,
  en-tête de `LogView` (les lignes `[spawn error]` / `[detect error]` n'existent plus).
- ✅ **Packaging.** `apps/desktop/package.json` : les cinq entrées `tools/capture/*` et `bin/adb` sortent de
  `build.extraResources` (pas d'entrée mitmproxy). **Écart au lot, assumé** : le script `fetch-binaries` et
  `scripts/fetch-binaries.mjs` restent, car ils construisent aussi le DLL du plugin Steam (`resources/capture-steam`,
  mappé par `extraResources`) et `build/icon.ico` — la règle « ce qui sert aussi à Steam reste » l'emporte ; seul
  `provisionPlatformTools` (adb) en sort. `scripts/before-pack.mjs` et `packaging.test.ts` restent (la garde
  « jamais de CA dans l'installeur » reste vraie). Aucune dépendance ne servait qu'à l'émulateur.
- ✅ **`.gitignore`** perd `apps/desktop/resources/bin/`, `tools/capture/dumps/`, `*.flows`, `*.log.err` et les trois
  lignes `tools/capture/cert/…`. Gardées, avec leur commentaire mis à jour, parce que des fichiers existent encore
  sur les postes : `tools/capture/out/` (données de compte des anciens setups dev, présentes ici) et
  `apps/desktop/resources/prod-cert/` (clé privée d'anciens builds, encore visée par la garde de `before-pack`).
- ✅ **Plugin Steam.** `GearSolverCapture.csproj` : un commentaire (« no emulator » → « no root »), sans effet sur la
  sortie. `src/Plugin.cs` **non touché** : ses deux commentaires qui citent `tools/capture/addon.py` changeraient
  le DLL et feraient proposer « Update plugin » à chaque joueur.
- ✅ **Docs.** `README.md`, `docs/architecture.md`, `docs/reference.md` (§ 1.1 réécrit pour le plugin, write-back),
  `docs/STATUS.md`, `docs/roadmap.md`, `docs/data-schema.md`, `docs/design-prompt.md`,
  `docs/design/home-dashboard-brief.md`, `docs/design/settings-redesign-brief.md`, `tools/capture-steam/README.md` ;
  wiki : `Capture-Pipeline.md` réduit à la capture Steam (le wiki n'a pas d'autre page Steam : liens conservés),
  `Using-the-App.md`, `Getting-Started.md`, `FAQ.md` (nouvelle entrée « I used the emulator capture of an older
  version — what now? »), `Home.md`, `Architecture.md`, `Roadmap.md`, `Engine-Reference.md`, `Data-Schema.md`.
  Commentaires de `packages/core` (`raw.ts`, `equip.ts`, `compose-stats.test.ts`) recalés. `docs/todo.md` : l'item
  « Support mobile et émulateur » sort, le cast `as PreflightResult` de l'item « Casts JSON » aussi. Les deux
  « ⏳ À valider sous Windows (LDPlayer) » des entrées S1 et S4 plus bas deviennent **sans objet** (entrées non
  réécrites). Notes joueur `[Unreleased]` : retrait, nettoyage de la CA, et ce qui reste sur un émulateur équipé —
  d'après `bind_cert.sh`, la CA n'était posée que par un `mount --bind` sur `/system/etc/security/cacerts`, non
  persistant : elle disparaît au redémarrage de l'instance ; restent des fichiers inertes (`/sdcard/c8750f0d.0`,
  `/sdcard/bind_cert.sh`, `/sdcard/redir.sh`, `/data/local/tmp/cacerts/` côté root), à supprimer à la main.
- ✅ **Tests.** `api-handler.test.ts` : cas `.mitm.pid` / armed / `captureRunArgs` retirés, Wipe sur les fichiers
  Steam, nouveau cas « les routes émulateur ne sont plus servies » (+ forme de `/api/capture/status`). Nouveau
  `legacy-cleanup.test.ts` (2) : suppression ciblée (snapshots et `seen-paths.log` gardés), sans effet sans les
  dossiers et au second passage. `paths.test.ts` sans `MANUAL_DEVICE` / `CAPTURE_CA_DIR` ;
  `captureStream.test.ts` / `snapshotFollower.test.ts` suivent les types.
- ✅ **Vérifié.** `npm run typecheck` sans erreur (dernière ligne `> tsc --noEmit`, renderer). `npm test` : core
  « Tests 105 passed (105) », desktop « Tests 75 passed (75) » (84 avant : −5 `capture-ca`, −6 `api-handler`, −1
  `paths`, +3 nouveaux), renderer « Tests 427 passed (427) ». `npm run desktop:build` passe. `git grep -il -E
  "emulator|ldplayer|adb|mitm"` ne rend plus que l'historique (`docs/changelog.md`, versions passées de
  `docs/release-notes.md`), ce qui nomme le retrait ou le nettoyage (`main.ts`, `legacy-cleanup.ts` et son test,
  `api-handler.test.ts`, `docs/architecture.md`, `wiki/Architecture.md`, `wiki/FAQ.md`, `[Unreleased]`) et des
  faux positifs (`readBody`, `padBottom`, `readBepinexVersion`, `commitMsg`, un hash de `package-lock.json`).
  `git diff --stat` hors cette entrée : 67 fichiers, +516 / −3049, dont 13 fichiers supprimés (−1359).
- ✅ **Poste local (hors git).** Supprimés ici : `apps/desktop/resources/bin/` (adb + mitmdump, désormais non ignoré :
  le pré-contrôle « arbre propre » de `release.mjs` aurait bloqué) et les `emulator-detect.js`, `capture-ca.js`,
  `mitm-provision.js` (+ `.map`) restés dans `apps/desktop/dist/` (`tsc` ne nettoie pas, et electron-builder emballe
  `dist/**/*`).
- ⏳ **Sevih.** Dans l'app : Settings sans choix de source, une capture Steam qui aboutit, l'import manuel, et
  `capture-ca/` (avec `bin/mitmproxy/`) disparu de `%APPDATA%\Outerpedia Gear Solver`. Sur le fixe : supprimer
  `apps/desktop/resources/bin/` et vider `apps/desktop/dist/` avant la prochaine release. Sur les deux postes :
  déplacer `tools/capture/out/` vers `.cache/capture-out/` puis réinstaller le plugin en dev (son `OutDir` pointe
  l'ancien dossier) ; la ligne `tools/capture/out/` du `.gitignore` pourra partir ensuite. Les deux commentaires
  `addon.py` de `Plugin.cs` sont à recaler au prochain changement du plugin.
- ⏳ **Repéré hors périmètre.** Le Wipe n'est pas refusé quand le plugin Steam est actif (le write-back, lui, l'est) ;
  l'item todo « bouton capture natif en packagé » date d'avant la source Steam.

### 🎮 Capture Steam — appid, racines Steam et BepInEx lus dans la référence d'outerpedia (2026-10-16)
- ✅ **Une seule source pour le client Steam.** Ce qu'il faut savoir du client Steam vit désormais dans outerpedia,
  `data/curated/game-client.json` (blocs `steam`, `client`, `bepinex`) ; gear-solver en garde une copie committée,
  `apps/desktop/src/game-client.json`, identique octet pour octet. Elle n'est ni dans `data/derived/` ni dans
  `SOLVER_FILES` : ce n'est pas une table du contrat solver, `tsc` l'émet dans `dist/` avec le reste du process
  principal et aucune installation ne la télécharge — la version de BepInEx et son sha256 restent figés dans chaque
  release.
- ✅ **`data/sync.mjs`** (`npm run data:sync`) la recopie depuis le checkout déjà trouvé par
  `findOuterpediaCheckout`, après les tables, avec la même règle : référence absente → message
  `missing reference: …` et sortie 1. En-tête du script complété.
- ✅ **`steam-capture.ts`** importe la copie (`import gameClient from "./game-client.json" with { type: "json" }`) :
  `OUTERPLANE_APPID` (`String(steam.appId)`), `GAME_EXE`, `BEPINEX_VERSION`, `BEPINEX_SHA256`, `BEPINEX_URL` et les
  racines Windows de repli de `findSteamRoot` (`steam.roots.windows`, passées par `normalize`) en sont lus ; mêmes
  noms d'export, mêmes valeurs. La clé de registre reste écrite en dur (hors de la liste du lot). Les deux chemins
  d'import vérifiés : `tsc -p . --outDir <scratch>` émet `game-client.json` et le module compilé, importé par Node,
  rend `4247320 OUTERPLANE.exe 5.4.23.5` ; `loadConfigFromFile` de Vite sur `apps/renderer/vite.config.ts` charge la
  config et liste `../desktop/src/game-client.json` dans ses dépendances (middleware du dev).
- ✅ **`GearSolverCapture.csproj`** : la liste des chemins de jeu reste (chemins de compilation sur les postes de
  Sevih, `-p:GameDir` gagne), un commentaire renvoie à `steam.roots` de la référence comme liste de vérité. Les
  relevés « build 24947556 » de `tools/capture-steam/README.md` ne bougent pas.
- ✅ **Docs.** `docs/architecture.md`, partie `tools/capture-steam` : une phrase sur la référence, sa copie et son
  rafraîchissement par `data:sync`.
- ✅ **Tests.** Nouveau `apps/desktop/test/game-client.test.ts` (2) : la copie est égale en profondeur (JSON parsé)
  au fichier du checkout d'outerpedia quand il est trouvé, sautée sinon avec « (skipped: no outerpedia checkout
  found) » dans son nom (la CI n'a pas de checkout) ; les exports de `steam-capture.ts` égalent la copie.
  `steam-status.test.ts` vert sans retouche.
- ✅ **Données.** `npm run data:sync` (outerpedia à `79868b8b`) : « synced 19 tables », version `77bba3140a60`,
  puis « synced game-client.json » ; `data/derived/` inchangé, seule la copie apparaît.
- ✅ **Vérifié.** `npm run typecheck` : les trois `tsc` sans erreur (dernière ligne `> tsc --noEmit`, renderer).
  `npm test` : core « Tests 105 passed (105) », desktop « Tests 84 passed (84) », renderer « Tests 427 passed
  (427) ».
- ⏳ **Laissé.** Afficher le client de référence (`client.version`, `client.buildId`) à côté de `build <id>` dans
  Settings, et avertir quand le client installé diffère : lots à part. La release qui embarque la copie reste à
  Sevih.

### 🛡️ Sets — niveau lu du contrat (paliers par pièce, `ignoreLowSet`), clé de dominance au niveau, sets de combat hors CP (2026-10-16)
- ✅ 🔴 **M1 + O5 — une seule fonction de niveau de set, lue du contrat.** outerpedia émet désormais la règle et ses
  données (`levels[].breakLimitCounts`, `levels[].ignoreLowSet` dans `sets.json`, ajouts seuls, `schema` 1 ;
  `SUPPORTED_SOLVER_SCHEMA` inchangé). Nouveau `packages/core/src/set-level.ts` (exporté par `index.ts`) :
  `pieceSetLevel(def, bt)` = la ligne dont `breakLimitCounts` contient le breakthrough ; `wornSetRows(def, bts)`
  rend la ligne du 2P (minimum des 2 meilleures pièces), celle du 4P (minimum des 4 meilleures) et `drop2`, le 2P
  effacé par l'`ignoreLowSet` de la ligne du 4P — stat par stat comme `CStatValue.SetSetItemValue` (même `st`), et
  pour un 2P d'effet de combat seulement si le 4P de cette ligne en est un aussi (`CreateBuffSetItem` ; Fortification
  niveau 2 porte le drapeau avec un 4P vide : rien n'est effacé). Repli commenté quand les champs manquent (cache
  d'avant C20) ou qu'aucune ligne ne liste le breakthrough : l'ancienne règle exacte (niveau 2 seulement si toutes
  les pièces sont BT4, même ligne pour 2P et 4P, sans `ignoreLowSet`), jamais la règle par pièce sans
  `ignoreLowSet` (Vitesse `[4,4,3,3]` vaudrait 38 %). `SetLevel` (`core/gamedata.ts`) gagne les deux champs,
  optionnels. `computeSetBonuses` (`composeBuild.ts`) groupe les breakthroughs par set et lit 2P et 4P dans leurs
  lignes ; même signature, même ordre de sortie, appel hors de la boucle talisman inchangé (le test « set-bonus
  hoist » de `solver.test.ts` passe, sur le repli puisque sa fixture n'a pas les champs). `BuildEffectsPanel`
  (`BuilderScreen.tsx`) lit `wornSetRows` : texte du 2P depuis la ligne du 2P, du 4P depuis celle du 4P, 2P effacé
  non affiché ; seul écart visuel, le voulu : un set en mélange BT4/BT3 montre le texte de la ligne du jeu (ex.
  Attaque `[4,4,3]` : « Attack +35% » au lieu de « Attack +30% »).
- ✅ 🔴 **Dominance au niveau de set.** `setKeyOf` de `pruneDominatedForCp` (`engine.ts`) passe par le nouveau
  `armorSetKeyOf(g, sets)` = `armorSetId|pieceSetLevel` : une BT3 ne peut plus éliminer une BT4 du même set (sur le
  repli, la clé vaut BT4 → 2 sinon 1, ce qui sépare aussi les pièces que l'ancienne règle distinguait). Docstring de
  `pruneDominatedForCp` suivie.
- ✅ 🔴 **C1, côté gear-solver.** La lecture reste « rien sans `st` » (`p2`/`p4` nul ou `ST_NONE` → rien). Le
  `sets.json` synchronisé porte le correctif C1 d'outerpedia : Pulvérisation (17), Faiblesse (20), Augmentation (21)
  sans stat à tous les niveaux, Immunité (18) sans stat au 4P niveau 2. Aucun champ d'effets de combat dans
  `sets.json` (clés de `levels[]` : `level`, `p2`, `p4`, `p2_desc`, `p4_desc`, `breakLimitCounts`, `ignoreLowSet`) ;
  un test vérifie qu'un tel champ posé à côté de `p2`/`p4` n'atteint jamais la liste de stats.
- ✅ **Docs.** `docs/reference.md` § 2.6 et `wiki/Engine-Reference.md` décrivent la règle par pièce, `ignoreLowSet` et
  le repli, et la ligne `sets.json` de leur table des sources nomme les deux champs ; `docs/data-schema.md` et
  `wiki/Data-Schema.md` décrivent les deux champs ; commentaire de `BuildEffectsPanel` réécrit.
- ✅ **Tests.** Nouveau `packages/core/test/set-level.test.ts` (12) sur le contrat réel de `data/derived` : Attaque
  `[4,4,3]` → 35 %, `[4,4,3,3]` → 35 + 20, `[4,4,4,3]` → 35 + 20, `[4,4,4,4]` → 35 + 25, `[3,3]` → 30 ; Vitesse
  `[4,4,3,3]` → 25 % (`drop2`), `[4,4]` → 13 %, `[4,4,4,4]` → 13 + 12 ; Pénétration `[4,4,3,3]` → 4P niveau 1 seul ;
  repli (mêmes lignes sans les champs) → 30, 30 + 20, 30 + 20, 35 + 25, 30, Vitesse 25 / 13, Pénétration 20, les
  résultats d'avant ce lot ; breakthrough non listé → repli ; lignes construites pour le « stat par stat » et
  Fortification niveau 2. `apps/renderer/test/setBonusKeys.test.ts` (+16) : `computeSetBonuses` sur le contrat réel
  (Attaque `[4,4,3]`, `[4,4,3,3]`, Vitesse `[4,4,3,3]`), champ d'effets de combat ignoré, et la garde C1 (sets 17, 20,
  21, 18 aux BT `[3,3,3,3]`, `[4,4,4,4]`, `[4,4,3,3]` → aucune stat). `apps/renderer/test/dominance.test.ts` (+2) :
  `armorSetKeyOf` (`1|1`, `1|2`, `—`) ; X BT3 domine Y BT4 en stats brutes, la clé par set seul garde X, la nouvelle
  garde les deux, et `solveChunk` en CP sur trois BT4 d'Attaque met Y en tête, CP de Y > CP de X.
- ✅ **Rejeu des scripts de la revue** (copie hors du dépôt, avant = `git archive HEAD`, après = l'arborescence du
  lot). `t2` : avant, build X (BT3) 19 959 CP, build Y (BT4) 20 091, prune `[X]` ; après, X 20 033 (son 2P passe au
  niveau 2 : `[4,4,4,3]`), Y 20 091 ; le script garde sa clé d'origine (`armorSetId`, toujours `[X]`), la même ligne
  avec `armorSetKeyOf` donne `[X, Y]`. `sets.ts` (§ A) : avant, `4/4/3` solveur 300 contre 350 en jeu, `4/4/3/3` et
  `4/4/4/3` 300 + 200 contre 350 + 200 ; après, les quatre cas égaux au jeu. Le § B (set Vitesse sur une base avec
  OAT_ADD, Claire 136 contre 133…) est inchangé, hors périmètre.
- ✅ **Données.** `npm run data:sync` (outerpedia à `ba3e08e0`, dernier commit du contrat `987e141e`) : « synced 19
  tables », version `b5b2bb33b258` ; `git diff --stat data/derived` vide, le contrat C20 était déjà synchronisé
  (`1596168`, puis `f7c9f2d`).
- ✅ **Vérifié.** `npm run typecheck` : les trois `tsc` sans erreur (dernière ligne `> tsc --noEmit`, renderer).
  `npm test` : core « Tests 105 passed (105) », desktop « Tests 82 passed (82) », renderer « Tests 427 passed
  (427) ».
- ⏳ **Laissé.** `GearDetail.tsx` (l. 86, fiche d'une pièce seule) garde `bt >= 4 ? 2 : 1` pour choisir sa ligne :
  vue d'une pièce, hors du lot, pourrait lire `pieceSetLevel`. Le set Vitesse sur une base avec OAT_ADD (mineurs de
  fiche) reste ouvert. Sevih : la release qui porte ce lot peut sortir (pas de montée de `schema`).

### 🧭 Builder et Worklist — ΔCP dit « projeté contre réel », le build le plus récent gagne, talisman conseillé lu en « préféré » (2026-10-16)
- ✅ 🔴 **M11 — le ΔCP du Builder dit sa base.** `deltaCp` (`build.cp − composition.currentCp`, `BuilderScreen.tsx`)
  compare le build compté dans le mode de reforge des résultats (`resultsReforge.reforgeMode`) à l'équipement tel
  qu'il est : en +10R6 un build identique au loadout affichait un ΔCP positif sans le dire. Décision de Sevih (15/10)
  appliquée : le calcul ne change pas, le libellé dit la base. Fonction pure `deltaCpLabel` (nouveau
  `apps/renderer/src/lib/deltaCp.ts`) : en `disable` (« Maxed only » y force déjà les résultats) → `ΔCP +X` inchangé,
  sans infobulle ; sinon `ΔCP +X vs equipped (build at +10R6)`, le libellé du mode tiré de `REFORGE_MODES`, et
  l'infobulle « The build is projected to +10R6; your equipped gear is counted as it is now. ». Seul endroit où ce
  ΔCP est affiché (recherche de `deltaCp`/`ΔCP` dans `apps/renderer/src`) ; `docs/solver.md` (diff par slot) précisé,
  et le même paragraphe, absent du miroir, ajouté à `wiki/Solver.md`. Test `test/deltaCp.test.ts` (2) : `disable` →
  `ΔCP +1,234` / `ΔCP -56` / `ΔCP 0` nus, `classic` → la mention `+10R6` et l'infobulle, `ascended` → `+15R9`.
- ✅ 🔴 **M12 — deux builds d'un même héros sur un même emplacement : le plus récent gagne.** `planWorklist`
  (`apps/renderer/src/lib/worklist/plan.ts`) ne comptait la contention qu'entre héros distincts : deux entrées du
  même héros visant l'arme avec W1 puis W2 passaient « applicable, 0 contention » et, la liste étant stockée la plus
  récente d'abord, le repli `equipAssignments` finissait sur la plus ANCIENNE. Décision de Sevih (15/10) appliquée :
  le propriétaire de chaque couple (héros, `WorklistChange.slot`) est l'entrée la plus récente (`createdAt`, à
  défaut l'ordre de la liste), lue sur toutes ses changes — appliquées et périmées comprises, pour qu'un build plus
  ancien ne défasse jamais une intention plus récente déjà en place. Une change actionnable d'une entrée plus
  ancienne sur ce couple sort de `assignments`, de la contention et de l'ordre, et va dans le nouveau champ
  `superseded: Map<entryId, Set<slot>>` du plan ; une entrée dont toutes les changes sont écartées ne compte plus
  dans `heroes`. `changeState` gagne `superseded` (lu de `supersededSlots`, jamais en même temps que `conflict`) et
  la carte de `WorklistScreen.tsx` affiche sous la ligne « Superseded by a newer build — skipped by Apply all. »,
  sans nouvelle action (« Apply locally » de la carte reste l'action explicite de l'entrée). En-tête de `plan.ts`
  et docstring d'`equipAssignments` (`equip.ts`) corrigés : l'ordre ne compte pas pour un lot cohérent, sans pièce
  pour deux héros ET sans deux pièces pour un même emplacement d'un héros. `worklistClaims` inchangé. Docs :
  `docs/solver.md` (état *superseded*), `wiki/Using-the-App.md`, ligne de `worklistPlan.test.ts` dans
  `docs/reference.md` / `wiki/Engine-Reference.md` (compte remis à 20). Tests (`test/worklistPlan.test.ts`, +6) :
  le cas de la revue (même héros, « new » W2 et « old » W1 sur l'arme, liste plus récente d'abord) → une seule
  assignation W2, « old » écartée sur `weapon`, `applicable` vrai, `heroes` 1 ; même cas liste inversée →
  `createdAt` décide ; une entrée ancienne à deux emplacements dont un seul repris → l'autre reste assigné ; deux
  héros sur une même pièce → contention inchangée ; `equipAssignments` (fetch stubé) sur ces assignations →
  W2 au héros, W0 et W1 libres ; la carte lit `superseded` sans `conflict`. Test de la revue rejoué sur une copie
  temporaire (`apps/renderer/test/tmp-wl.test.ts`, supprimée, non commitée) : avant `applicable true hasDeps false
  contended 0 assignments ["W2","W1"]`, après `applicable true hasDeps false contended 0 assignments ["W2"]`.
- ✅ 🟡 **`Talisman` de `/api/reco` lu en « préféré ».** outerpedia émet `Talisman?: RecoGearStat[]` dans chaque
  build ; le type `StructuredRecoBuild` (`translateReco.ts`) ne l'avait pas, le conseil était perdu. Décision de
  Sevih (15/10) appliquée : (a) `translateRecoBuild` le lit comme Weapon/Amulet (`effectPicks` prend maintenant
  l'état à poser) dans `RecoFilterPatch.talismanEffectPicks: Record<string, "preferred">`, référence non résolue →
  avertissement ; (b) `SolveFilters` gagne `talismanEffectPicks?` (`TalismanEffectConstraint` = `required` |
  `excluded` | `preferred`, absent = aucune contrainte) et `SolverFilters` du Builder `talismanEffectPicks`
  (`ChipState` gagne `preferred`) ; dans `precomputeContext` (`engine.ts`), `required`/`excluded` filtrent dans
  `allow()` comme pour les armes (clé `setId` de `equipment.json`, partagée par les variantes, ex. « 3029, 3129 »
  pour le Tactician's Charm 6★), et `preferred` s'applique juste après la construction des pools : si au moins une
  pièce du pool talisman (donc après tous les filtres d'`allow()`) porte l'un des `setId` préférés, le pool est
  restreint à celles-là, sinon il reste entier — jamais 0 build à cause d'un talisman préféré ; en « keep current »
  le talisman porté reste verrouillé (`lockedSlots`). (c) Reducer : `mergePreset` remplace `talismanEffectPicks` en
  bloc, `cycleEffectPick` gagne le groupe `talisman`, `preferred` repart sur `required` au clic ; `INITIAL_FILTERS`
  (donc `resetAll`) et `buildSolveFilters` le portent, le badge du bouton Effects le compte. (d) Le panneau
  `WeaponsAccessoriesPanel` devient « Weapons, accessories & talismans » (indice ajusté) avec un groupe Talismans
  tiré de l'inventaire par `effectCatalogFromInventory` (slot `talisman`) ; `EffectIconChip` rend `preferred` dans
  les styles de `required` avec un contour pointillé, `EffectBadge` un `~`, infobulle « preferred by the
  recommendation (click to require) ». (e) Après Get preset, `applyRecoBuild` ajoute « None of the recommended
  talismans is owned — any talisman will be used. » quand aucun talisman de l'inventaire n'a l'un des `setId`
  conseillés. (f) `filterPresets.ts` : `sanitizeTalismanEffects` accepte `preferred` et les `setId` en liste des 6★
  (« 3029, 3129 », que le filtre des armes, numérique seul, aurait jetés), un preset ancien sans le champ → `{}`.
  `heroFilters.ts` (session, écrit par le code courant) et `transfer.ts` (blobs bruts relus par
  `loadFilterPresets`) n'ont rien à changer. Docs : `docs/solver.md` / `wiki/Solver.md` (panneau), `wiki/Using-the-App.md`
  (Get Preset), ligne de `translateReco.test.ts` dans les tables de tests. Tests : `translateReco` (+3 : résolu →
  `preferred`, non résolu → avertissement, sans conseil → `{}`) ; nouveau `test/talismanPreferred.test.ts` (6, vrai
  contrat, `precomputeContext` sur un petit inventaire) : préféré possédé → pool réduit à lui et sa variante,
  non possédé → pool entier, possédé mais écarté par la classe ou par la portée « equipped » `none` → pool restant
  entier, `required` non possédé → pool vide, `required`/`excluded` possédés, keep current → le porté reste seul,
  champ absent → pool entier ; `filterPresets` (+4 : preset ancien → `{}`, `preferred`/`required`/`excluded`
  rendus tels quels, état ou clé inconnus jetés, `preferred` refusé sur une arme).
- ✅ Vérification : `npm run typecheck` → dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` → dernière
  ligne `Tests  409 passed (409)` (renderer ; core 93, desktop 82).
- ⏳ Sevih : regarder dans l'app le libellé du ΔCP en +10R6 et en Off, une carte Worklist écartée, et le groupe
  Talismans après un Get preset (contour pointillé, message quand le talisman n'est pas possédé).
- ⏳ Laissé : le conseil vise le `setId` du palier max de la famille (« 3029, 3129 ») — un Tactician's Charm 5★
  (`3018`) n'est pas reconnu comme préféré (même règle que les armes, hors périmètre). Après un Apply all,
  `reconcileWorklist` supprime l'entrée récente appliquée et l'ancienne redevient actionnable sur ce slot (règle de
  `reconcileWorklist`, non touchée). Le total « 300 tests » de `docs/reference.md` §3.3 était déjà périmé, non
  recompté.

### 💎 Moteur — gemmes complétées par la stat utile du héros, chaque pièce projetée à son propre plafond (2026-10-16)
- ✅ 🔴 **M7 — une priorité partielle ne laisse plus d'emplacement de gemme vide.** Les quatre allocateurs de
  `apps/renderer/src/lib/solver/gems.ts` s'arrêtaient au premier score ≤ 0 : avec `{ critDmg: 3 }` sur un pool
  15046 ×5 (ATK +4 %) + 15050 ×2 (CHD +4), le talisman recevait `[15050, 15050, 0, 0, 0]` et l'EE rien, le +20 %
  ATK des gemmes possédées sortait de la fiche et de la CP. Décision de Sevih (15/10) appliquée telle quelle :
  une fois la priorité servie (gemmes de score > 0 dans leur ordre, plafond CHC inchangé), les emplacements
  libres prennent les gemmes de score **exactement 0**, par gain relatif de `dmg` décroissant puis par magnitude
  brute (`value / ROLL_NORMS`, le repli `allowZeroPriority`). Forme conseillée retenue : `ScoredGem.fill`
  (optionnel ; absent = jamais posé en remplissage), posé par `scoreGemPool` à partir de deux nouvelles
  options — `fillGain` (gain `dmg` d'une gemme) et `noFill` (clés de priorité portant un `max` dans
  `filters.statFilters`, jamais posées en remplissage) — et trié après les scores positifs sans toucher à leur
  ordre (tri stable, départage seulement à score 0). Un seul parcours, `pickOrder` (les priorités jusqu'au
  premier score ≤ 0, puis les remplissages ; un score négatif n'est jamais visité), lu par `allocateGems`,
  `aggregateGemDelta`, `allocateGemsCapped` et `allocateGemsReachingCap` : la répartition affichée et le delta
  composé ne peuvent pas diverger. Plafond CHC : `allocateGemsCapped` saute aussi une gemme crit de
  remplissage au cap, et l'étage 2 d'`allocateGemsReachingCap` ne saute plus toute gemme crit mais celles
  posées au cap (équivalent pour les gemmes crit priorisées — il n'en reste qu'au cap après l'étage 1 —, et
  une gemme crit de remplissage suit le même saut) ; le chemin sans priorité crit du hot loop (`fs.critRate >
  102`) se déclenche aussi sur des gemmes crit de remplissage. Le gain `dmg` vient de `gemDmgGains`
  (`engine.ts`, à côté de `cpStatWeights`) : `computeCheapRatings(…).dmg` avec `meta.dmgStat`, `meta.dmgSec`
  et `meta.noCrit` (le modèle de `dmgTickGains`, panneau « DMG per 1 % »), gemme routée comme un sub
  (`computeFinalStatsPlusRoll`), pesé **une fois par solve** sur le build équipé du héros comme
  `reforgeTickWeights` (CHC au cap → 0, héros `noCrit` → CHC/CHD à 0, stat hors modèle → 0 puis magnitude).
  `precomputeContext` le passe à `scoreGemPool` ; `dmgStat`/`noCrit` y sont lus une fois et réutilisés pour le
  contexte rendu. Inchangé : SOLVE sans aucune priorité (aucun `fill` → `null` → gemmes serties), le score du
  build (`computeScore`), SOLVE CP sans priorité (poids CP — ses gemmes à poids 0 remplissent maintenant par la
  même règle). M8 non touché (`allocateGems` et `aggregateGemDelta` restent deux fonctions).
- ✅ 🟠 **M10 — chaque pièce projetée à son plafond réel.** `REFORGE_PLANS` projetait toute pièce en 6★ maxée
  (budget fixe 6 ou 9, main à +15 ascendée et passif de singularité en +15R9) : une arme 5★ `unique` +10 R5
  sortait en +15R9 avec 9 reforges, ATK 600 → 690 et DMG +50 %, ce que le jeu refuse
  (`CItem.IsSingularityActivate` : 6★ `unique` seulement ; `CUIItemSmelting` : budget = étoile sous 6★, 6 ou
  6 + 3 pour une 6★ ascendée). Nouvelle `pieceReforgePlan(piece, mode)` exportée : peut ascender ⇔ 6★ ET
  `unique` (`canAscend`) ; sinon plafond `REFORGE_PLANS.classic.ceiling` (+10, sans ascension ni passif) quel
  que soit le mode ; budget = `min(budget du mode, maxReforgesOf(piece, ascends && mode ≠ classic))`.
  `maxReforgesOf` prend un second paramètre `ascended` (défaut : l'état de la pièce) au lieu d'une deuxième
  copie de la règle 6/9. `projectPieceForReforge` lit ce plan — donc le moteur ET la bande de pièces du
  Builder, qui l'appelle déjà : la carte suit le score ; `projectMainToCeiling` reçoit le plafond par pièce et
  ne déclasse toujours pas une pièce au-dessus. `REFORGE_PLANS` reste le plafond du MODE ;
  `maxedFloorOf`/`meetsMaxedFloor` inchangés. Lié : `UiPiece.reforge.max` (`design/adapter.ts`) lit
  `maxReforgesOf` (9 pour une 6★ ascendée, au lieu de l'étoile). Textes : infobulles des trois modes
  (`REFORGE_MODES`, `BuilderScreen.tsx`), commentaires d'`engine.ts` (« every piece is previewed as a maxed
  6★ », `simulateReforges`, `SINGULARITY_CEILING`), `docs/solver.md` (§ Options, § Gems),
  `docs/reference.md` (§ 2.7 gemmes, § 2.9 projection) et leurs miroirs `wiki/Solver.md`,
  `wiki/Engine-Reference.md` (paragraphe de projection ajouté, il n'y était pas), `wiki/Using-the-App.md`
  (§ Options).
- ✅ **Tests.** Nouveau `apps/renderer/test/gemFill.test.ts` sur le contrat réel `data/derived` (11 tests) :
  le cas de la revue (appel direct et via `prepareContext`, héros 2000001) → talisman
  `[15050, 15050, 15046, 15046, 15046]`, EE `[15046, 15046, 0, 0, 0]` ; HP à priorité −1 jamais posé ; ATK
  sous `max` jamais posé en remplissage ; Drakhan (`dmgStat: "hp"`) remplit HP % avant ATK % (la magnitude
  brute dirait l'inverse) ; Rhona (`noCrit`) prend les ATK % lv5 avant les CHD lv6 ; `aggregateGemDelta`
  = les gemmes d'`allocateGems` (4 et 5 emplacements) ; SOLVE sans priorité → delta `null`, aucun `fill` ;
  SOLVE CP sans priorité → les 7 gemmes posées ; `allocateGemsCapped` / `allocateGemsReachingCap` : une
  seule gemme crit de remplissage sous le cap, aucune au cap ; sans `fill`, arrêt aux priorités. Dans
  `solver.test.ts` (6 + 1 tests) : 5★ en +10R6 → 5 reforges ; 5★ en +15R9 → +10, 5 reforges, pas
  d'ascension ni de passif, main inchangé ; 6★ `rare` en +15R9 → +10, 6 reforges, sans passif ; 6★ `rare`
  en +10R9 → 6 ; 6★ `unique` en +15R9 → +15, 9, passif (et les tests existants de `simulateReforges`, du
  budget par mode et du passif projeté passent sans changement) ; `pieceReforgePlan` (4★ → 4, 6★ 6/9,
  plafond +10 d'une 5★) ; `toUiPiece` : 6★ ascendée → max 9, 6★ → 6, 5★ → 5. Commentaire du test
  « budget override » recalé (la surcharge reste, le « tout en 6★ » non). Tests existants d'allocation
  inchangés : un `ScoredGem` écrit à la main sans `fill` n'est jamais un remplissage.
- ✅ **Rejeu de la revue** (copie de `moteur/` hors du dépôt, chemins vers la racine du dépôt) : `t4.ts`
  avant — `delta {"flat":{},"pct":{"critDmg":8}} alloc {"talisman":[15050,15050,0,0,0],"ee":[0,0,0,0,0]}` ;
  après — `delta {"flat":{},"pct":{"critDmg":8,"atkPct":20}} alloc
  {"talisman":[15050,15050,15046,15046,15046],"ee":[15046,15046,0,0,0]}`. `t6.ts` avant — `classic
  reforgeCount 6 … enh 10`, `ascended reforgeCount 9 ascended true enh 15 main [["atk",690,"option"],
  ["dmgUp",50,"singularity"]]` ; après — `classic reforgeCount 5 ascended false enh 10 main
  [["atk",600,"option"]]` et `ascended reforgeCount 5 ascended false enh 10 main [["atk",600,"option"]]`,
  sans `singularity`. `npm run typecheck` : dernière ligne `> tsc --noEmit` (renderer, sans erreur) ;
  `npm test` : `Tests  388 passed (388)` (renderer, 34 fichiers).
- ⏳ **Sevih — « Maxed only » doit-il vouloir dire « au plafond de la pièce » ?** Le plancher exige toujours le
  budget du mode : une 5★ +10 R5 reste exclue d'un solve « Maxed only » +10R6, alors que la projection la
  tient maintenant pour maxée. Décidé le 15/10 pour le lot suivant, pas touché ici.
- ⏳ **Vu, hors périmètre.** Une pièce sans étoile (`star: null`, objet absent du contrat) a maintenant un
  budget de 0 et n'est plus projetée en reforges (elle recevait 6 ou 9) ; les règles 6/9 et le plafond par sub
  restent recopiés à la main (item ⚪ « Règles du jeu recopiées ») ; les comptes de tests du README et de
  `docs/reference.md` (§ tests) étaient déjà périmés, non recalés.

### 🧮 Fiche — héros fusionnés calculés sur leur vrai personnage partout, main stat en float32 comme le jeu (2026-10-16)
- ✅ 🔴 **M4 — un héros en Core Fusion est composé sur sa variante `27xxxxx` dans le Builder, le moteur et
  la Worklist, plus seulement dans Builds.** Seul Builds lisait `characters[fusionCharId]` (helpers locaux
  `effectiveCharId`/`metaOf`, T16) ; `composition` et `heroClass` du Builder et `precomputeContext` lisaient
  l'origine : Snow fusionnée à 1 370 ATK / 5 770 HP / 1 331 DEF / 149 SPD au lieu de 1 503 / 6 452 / 1 366 /
  155, Lisha 1 922 ATK au lieu de 2 093, Notia 170 EFF au lieu de 255, Veronica fusionnée notée sur l'ATK au
  lieu des PV. Nouvelle `effectiveCharacter(c, characters)` dans `packages/core/src/gamedata.ts` (exportée
  par `index.ts`) : `{ charId, def }` de la fusion quand `fusionCharId` ≠ 0, de l'origine sinon ; fusion
  absente du contrat (capture plus récente que les données synchronisées) → repli sur l'origine, commenté ;
  pas encore de table → l'id fusionné sans fiche, comme l'ancien `effectiveCharId` pour le portrait. Builds
  l'appelle à la place de ses deux helpers (supprimés, `ComposedEntry.meta` typé `CharacterDef | null`) ; le
  Builder pour `composition` (commentaire « Same pipeline the Builds tab uses » rendu vrai et précisé) et
  `heroClass` ; le moteur dans `precomputeContext`, donc la base sans équipement, `dmgStat`, `dmgSec`,
  `noCrit`, `bestSkill` et la ligne de transcendance de la CP viennent de la fusion, comme sur la carte
  Builds ; la Worklist stocke l'id effectif dans `charId` d'une nouvelle entrée (portrait, comme
  `displayCharId` de Builds), `heroName` inchangé. Noms affichés (`displayNameOf`), carte et portrait du
  héros dans le Builder, recherche et reco : inchangés. `charLevelMax` non touché : depuis C17
  d'outerpedia, `data/derived/characters.json` donne au fusionné l'étoile de son origine (`star` 2 pour
  2000003 et 2700003, 2 pour 2000005/2700005, 3 pour 2000037/2700037), la clé `${star}|${step}` est la même
  dans les deux metas — vérifié par un test.
- ✅ **Rejeu de la revue** (copies hors du dépôt, chemins vers la racine du dépôt, esbuild de l'annexe) :
  `fusion.ts` avant — Snow « Builder/moteur (2000003) : ATK 1370 HP 5770 DEF 1331 SPD 149 EFF 170 | Builds
  (2700003) : ATK 1503 HP 6452 DEF 1366 SPD 155 », Lisha 1922 | 2093, Notia EFF 170 | 255, Veronica
  identique ; après (côté Builder/moteur composé sur l'id rendu par `effectiveCharacter`) : les quatre
  lignes égales des deux côtés (Snow 1503/6452/1366/155, Lisha 2093, Notia EFF 255). `ui/fusion.test.ts`
  compose par id sans passer par le code de l'app : mêmes sorties avant et après (2000003 ATK 1370 ≠
  2700003 ATK 1503 ; 2700037 `dmgStat hp`, 2000037 `atk`), ce que le moteur lit maintenant (test ci-dessous).
- ✅ 🟡 **Main stat en float32 comme le jeu.** `parse.ts` calculait `(1 + enhanceFactor × lv) × (1 +
  tierFactor × tier)` en double puis `floor` avec epsilon ; le client (`CItem.InitializeOptionData`,
  `CItemMainOption.get_OptionValue`) fait tout en float32 et tronque : 21 états sur 7 140 par type de pièce
  lisaient 1 de trop (base 60 +0 palier 1 → 62 en jeu, 63 ici ; 90 +4 → 233 / 234 ; 100 +6 palier 1 → 356 /
  357 ; 120 +0 palier 1 → 125 / 126). `scaleMain` (désormais exportée) reçoit l'`OptionValue` BRUTE
  d'`options.json` (‰ pour un pourcentage, avant le ÷10 de `resolveOption`), refait la chaîne
  d'outerpedia (`sumFactorsF32` + `itemMainOptionValue` de `src/lib/damage/item.ts`, recopiés et commentés,
  sans import entre dépôts) avec les facteurs d'`enhance.json` (`enhanceFactor` × lv — le max une fois
  ascendée —, `tierFactor` × palier, `singularity.activation` + paliers atteints), tronque, puis divise par
  10 pour un pourcentage. Le parseur pose sur chaque main `source: "option"` non-buff un champ optionnel
  `rawBase` (`RolledStat`, `types.ts`) = cette valeur +0 ; `projectMainToCeiling` en repart (même chiffre
  que le jeu à l'état visé) et ne garde le rapport de multiplicateurs (`mainMult`/`roundMain`, gardés pour
  ça et pour le « jamais de baisse ») qu'en repli sans `rawBase`. Talisman (`ooparts`) et mains IOT_BUFF
  inchangés. `docs/solver.md` et `wiki/Solver.md` (re-scale du main en mode reforge) corrigés.
- ✅ **Rejeu de l'audit** `mainstat.mts` (copie hors du dépôt, `solver` remplacée par la nouvelle
  `scaleMain` importée depuis un bundle esbuild de `parse.ts` — `node --experimental-strip-types` ne
  résout pas les imports `.js` du source —, `REPOS` = le dossier parent des dépôts) : avant
  `jeu_vs_solver` 21 pour `ITS_EQUIP_WEAPON`, `ITS_EQUIP_ARMOR` et `ITS_EQUIP_ACCESSORY` ; après 0 pour les
  trois (`wiki_vs_solver` 21 → 0, `jeu_vs_wiki` 0).
- ✅ **Tests** — `core-fusion-captures.test.ts` : `effectiveCharacter` (Snow 2000003/2700003 → 2700003 et
  sa fiche ; non fusionné → origine ; fusion retirée de la table → origine ; table absente → id fusionné,
  fiche nulle ; même `star` origine/fusion pour Snow, Lisha, Veronica). `apps/renderer/test/coreFusion.test.ts`
  (nouveau, contrat réel) : `precomputeContext` de Snow fusionnée = la composition de la carte Builds sur
  2700003 et ≠ celle de l'origine ; Snow non fusionnée sur l'origine ; Veronica fusionnée (2700037) →
  `dmgStat` `hp`, l'origine `atk`. `main-stat-f32.test.ts` (nouveau) : les quatre exemples (en plat et en
  pourcentage) ; exhaustif sur les 84 `OptionValue` d'`IOT_STAT` d'`options.json` × +0..+10 et +10 ascendé
  singularité 0..5 × palier 0..4 contre la copie de la formule d'outerpedia → 0 écart ; talisman non
  scalé ; projection d'une pièce +0 palier 1 (62) vers +10 = la valeur parsée d'une vraie +10 (315), et
  repli au rapport sans `rawBase` (310). Aucun test existant de valeur de main (parse, reforgeProjection,
  solver) n'a bougé : leurs fixtures ne tombent sur aucun des 21 états. Commentaires de test qui citaient
  l'ancien helper / le rapport mis à jour. `npm run typecheck` : sortie 0 (dernière ligne `> tsc --noEmit`,
  sans erreur) ; `npm test` : sortie 0, dernière ligne `Tests  371 passed (371)` (core 93, desktop 82,
  renderer 371).
- ⏳ Vérifier dans l'app sur un fusionné (Snow, Lisha) que la colonne Current du Builder et ΔCP lisent les
  mêmes chiffres que la carte Builds. Restent M5 (niveaux de compétence des fusionnés, bloqué sur une
  capture) et, hors périmètre, la carte et le portrait du héros dans le Builder (id d'origine) ainsi que le
  tableau des tests de `docs/reference.md` § 3.3, déjà en retard avant ce lot (« 300 tests »).

### 🧹 Capture — `game.flows` en option de debug, Wipe du dossier entier, vérification de mise à jour au lancement (2026-10-16)
- ✅ 🟠 **L'enregistrement complet du trafic de capture devient une option de debug, coupée par
  défaut.** `capture.ps1` passait `-w game.flows` à mitmdump à chaque capture : tout le trafic du jeu
  (en-têtes et corps) restait sur le disque jusqu'au Wipe suivant. Nouveau paramètre
  `[switch]$RecordFlows` : `-w` n'est passé que s'il est présent ; sans lui, un `game.flows` laissé
  dans `-Out` par une version précédente est supprimé au lancement. Côté app : **Settings → Debug →
  « Record full capture traffic (game.flows) — debugging only »** (clé `gs.debug.captureFlows`,
  `false` par défaut, sur le modèle des deux bascules voisines). `runCapture` appelle alors
  `POST /api/capture/run?recordFlows=1`, et `api-handler.ts` ajoute `-RecordFlows` aux arguments de
  `capture.ps1`, en dev comme en prod, via la fonction pure `captureRunArgs(scriptArgs, query)`
  (seule la valeur `1` l'active). `tools/capture/README.md` et `wiki/Capture-Pipeline.md` décrivent
  l'option et le contenu du dossier de sortie.
- ✅ 🟠 **Wipe vide tout le dossier de capture, journal et `_unknown/` compris.**
  `POST /api/capture/wipe` ne supprimait que `*.json`, `.captured`, `seen-paths.log` et `*.flows` :
  `mitm.log`, `mitm.log.err` et `_unknown/` (réponses décodées des chemins hors liste, écrites par
  `addon.py` et par le plugin Steam) restaient. Chaque entrée de `captureOut` est maintenant
  supprimée (`rmSync(…, { recursive: true, force: true })`), le dossier lui-même est gardé (la
  capture et le plugin Steam écrivent dedans). Le 409 pendant que la capture est armée ne change pas ;
  `removed` compte les entrées supprimées. Textes mis à jour : l'action et sa confirmation
  (Settings → Data), `wiki/FAQ.md`.
  **Plugin Steam** : son battement `.steam-plugin.json` était déjà supprimé par l'ancien Wipe (il finit
  en `.json`). Sans fichier, `readHeartbeat` renvoie `null` et `steamStatus` répond « pas live »,
  sans erreur ; le plugin réécrit son battement à sa prochaine réponse décodée (`WriteKnown`) ou au
  prochain lancement du jeu, et le statut revient alors. Il recrée `_unknown/` à la première écriture ;
  `seen-paths.log` ne reprend que les chemins pas encore vus depuis le lancement du jeu (liste en
  mémoire du plugin). Côté émulateur, `addon.py` recrée `_unknown/` à son chargement, donc au
  prochain armement.
- ✅ **Un échec de la vérification de mise à jour au lancement est attrapé et affiché.**
  `setupAutoUpdate` lançait `void autoUpdater.checkForUpdates()` en comptant sur l'événement
  `error` ; electron-updater rejette aussi la promesse, et ce rejet n'était pas attrapé. Il l'est
  maintenant comme dans `triggerCheck` : état `error`, message, `dwarn`. Commentaire corrigé ;
  configuration de build inchangée.
- ✅ **Tests** — `api-handler.test.ts` : `captureRunArgs` sans l'option (requête vide, `0`, `true`)
  et avec (`-RecordFlows` ajouté, tableau d'origine intact) ; Wipe d'un `captureOut` qui contient
  deux `.json`, `mitm.log`, `mitm.log.err`, `game.flows`, `seen-paths.log`, `.captured` et
  `_unknown/a.json` → dossier présent et vide, `removed: 8` ; 409 quand la capture est armée, rien
  supprimé ; le test du `.mitm.pid` périmé passe sans retouche. `updater.test.ts` (nouveau) : avec
  le mock d'`electron-updater` dont `checkForUpdates` rejette (`electronUpdaterMock` prend
  maintenant une fonction de remplacement), aucun rejet non attrapé et `getStatus().state === "error"`
  — le test échoue sur le code d'avant. `npm run typecheck` : sortie 0 (dernière ligne
  `> tsc --noEmit`, sans erreur) ; `npm test` : sortie 0, dernière ligne de résumé
  `Tests  368 passed (368)` (core 80, desktop 82, renderer 368).
- ⏳ **À valider sous Windows (LDPlayer)**, le PowerShell ne tourne pas sous Linux :
  1. option coupée, avec un `game.flows` laissé dans `capture-out` par une version précédente :
     Arm capture → la capture aboutit, aucun `game.flows` créé et l'ancien a disparu ;
  2. Disarm, option cochée (Settings → Debug), Arm capture → `game.flows` présent dans `capture-out` ;
  3. Disarm puis Settings → Data → Wipe captured data → le dossier `capture-out` existe et est vide
     (`mitm.log`, `mitm.log.err`, `_unknown/` compris) ; Arm capture suivant : la capture aboutit.

### 🧾 Données de jeu — lecture du `schema` du contrat, refus d'un schéma plus récent (2026-10-15)
- ✅ 🟠 **G1 — l'app lit le `schema` de `version.json` et refuse un contrat qu'elle ne sait pas lire.**
  outerpedia ajoute `schema` (entier, 1 aujourd'hui) et `resVersion` à `version.json` ; jusqu'ici rien
  ne disait quelle forme avaient les tables, et un changement de forme côté outerpedia serait arrivé
  d'un coup chez toutes les installations. `data-sync.ts` exporte `SUPPORTED_SOLVER_SCHEMA = 1` (le
  commentaire renvoie à la règle d'outerpedia : on la monte dans la release qui lit le nouveau champ,
  étape (b)), `solverSchemaOf` (pure : `schema` absent → 1, contrat d'avant et cache existant ;
  entier ≥ 1 → lui ; texte, décimal, 0, négatif, JSON illisible → null) et `schemaRefusal`.
- ✅ **Mode REPO** — le schéma se vérifie juste après le téléchargement de `version.json`, avant la
  comparaison de hash et toute autre table, en `force` aussi (bouton « Sync game data »). Refus : rien
  écrit, cache intact, statut `error` (`unavailable` sans cache), message « outerpedia's game data uses
  format 2, this version of gear-solver reads up to format 1 — update gear-solver; keeping the cached
  data » ; il se lit dans « Game data sync failed — … . » et « Game data: … », renderer inchangé. Le SHA
  n'est PAS enregistré : la gate (`latest === cached && derivedReady` → `fresh`) répondrait sinon
  « à jour » à chaque lancement et une app mise à jour ne reprendrait jamais ces données — vérifié par
  un test. **Mode CHECKOUT** — même vérification sur le `version.json` du checkout avant toute copie.
- ✅ **`data/sync.mjs`** — même refus avant toute écriture dans `data/derived/` (sortie 1). Choix :
  jumeau `scripts/solver-schema.mjs` (constante + deux fonctions), sur le modèle
  `outerpedia-checkout.ts` / `.mjs` ; un test vérifie que les deux s'accordent sur 14 corps. Une source
  unique aurait demandé d'importer du `.mjs` depuis le `tsc` du desktop (`allowJs`, `rootDir`), plus
  intrusif. `docs/data-schema.md` (cycle après patch) décrit `{ schema, resVersion, hash, builtAt }`,
  le refus et quand monter la constante.
- ✅ **Tests** — `data-sync.test.ts` (`stubRemote` sert des champs en plus) : sans `schema`, les
  trois tests existants passent sans retouche ; `schema: 1` synchronise ; `schema: 2` → `error`,
  aucune table demandée après `version.json`, `version.json` + `characters.json` + SHA intacts, idem
  en `force` ; sans cache → `unavailable` ; `"1"`, `1.5`, `0`, `-1`, `null` refusés ; après un refus,
  une app qui lit 2 (option `supportedSchema`, réservée aux tests) synchronise au lancement suivant.
  CHECKOUT (faux checkout via `OUTERPEDIA_PATH`) : `schema: 2` ne copie rien, `schema: 1` copie.
  `sync.mjs` en processus enfant contre un faux checkout `schema: 2` : sortie ≠ 0, message, et
  `data/derived/version.json` inchangé (le faux checkout ne porte que `version.json`, donc même une
  vérification cassée s'arrêterait à la première table manquante sans écrire dans le dépôt).
  `npm run typecheck` : sortie 0 (dernière ligne `> tsc --noEmit`, sans erreur) ; `npm test` : dernière
  ligne `Tests  368 passed (368)` (core 80, desktop 77, renderer 368).
- ⏳ `npm run data:sync` non lancé : le checkout voisin `../outerpedia` ne porte pas encore A56 (son
  `version.json` n'a pas de `schema`). Après le commit d'A56 : `npm run data:sync`, vérifier que seul
  `data/derived/version.json` change (`hash` `e0d0b39edac2` identique) et le commiter.
- ⏳ Afficher `resVersion` (lot à part, `apps/renderer/src/game-version.ts`) : le `hash` ne bouge pas
  quand seul `resVersion` change, donc le `version.json` du cache (même `hash` → arrêt avant écriture)
  peut garder un `resVersion` ancien.
- ⏳ Repéré hors périmètre : l'en-tête de `apps/renderer/test/outerpediaCheckout.test.ts` dit que le
  desktop n'a pas de lanceur de tests, ce qui n'est plus vrai (`apps/desktop/vitest.config.ts`).

### ⚙️ Moteur — « Maxed only » en +15R9 et ticks de reforge sans priorité (2026-10-15)
- ✅ 🔴 **M6 — « Maxed only » en +15R9 ne renvoyait jamais aucun build.** `meetsMaxedFloor` exigeait
  +15 du talisman, qui plafonne à +10 (pas de singularité, courbes ooparts de 11 entrées) : le pool
  talisman se vidait. Le plancher talisman est maintenant `min(plafond du mode, enhance.maxEnhanceLevel)`
  — +10, lu dans le contrat ; les autres pièces gardent leur +15.
- ✅ 🔴 **M9 — Sans priorité, la projection de reforge envoyait tous les ticks sur les PV plats.**
  `simulateReforges` départageait à la valeur brute d'un tick (180 PV contre 4 %) : 5 ticks faisaient
  passer HP de 180 à 1080. Sans priorité, chaque sub est maintenant pesé par la CP qu'un tick ajoute
  au build équipé du héros (`reforgeTickWeights`, routé comme un vrai sub : un % passe par la base du
  héros) ; sans ces poids, par sa part d'un roll max (`1 / ROLL_NORMS`). Les égalités se départagent
  au tick normalisé. Les poids reviennent avec le résultat (`onResult`) et sont sauvés avec le build :
  les gear cards du Builder reprojettent les mêmes ticks que le moteur.
- ✅ **Tests** — `reforgeProjection.test.ts` sur le contrat réel (héros 2000001) : build +15R9
  « Maxed only » trouvé avec un talisman +10, talisman +9 écarté ; ticks par poids CP en SOLVE et
  SOLVE CP, PV hors de tête, reprojection identique côté gear band, priorité explicite inchangée.
  `solver.test.ts` : plancher talisman borné, cas rejoué de la revue (PV 180 → 360 au lieu de
  1080), poids CP suivis, priorité prioritaire sur les poids.

### 🔐 Capture émulateur — CA générée sur le poste de l'utilisateur (2026-10-15)
- ✅ 🟠 **La CA de capture est générée sur le poste de l'utilisateur au premier lancement ;
  l'installeur n'en livre plus.** Avant, `fetch-binaries.mjs` produisait une CA mitmproxy au build
  (`resources/prod-cert/`, réutilisée d'un build à l'autre) que l'installeur embarquait : toutes les
  installations partageaient la même. Désormais chaque installation a la sienne.
- ✅ **Génération** — `capture-ca.ts` : avant le premier armement (`prepareCapture`, après le
  téléchargement de mitmdump), le mitmdump de `userData` est lancé avec `--set confdir=<dossier>` ;
  il écrit `mitmproxy-ca.pem` + `mitmproxy-ca-cert.pem`, on l'arrête et on copie le cert sous
  `c8750f0d.0` (sujet fixe → nom constant, pas d'openssl chez l'utilisateur). Génération dans
  `<dossier>.new` renommé une fois complet (une génération interrompue ne laisse rien de
  réutilisable) ; une CA existante est toujours réutilisée (seul le `.0` est recopié s'il manque).
  Dossier : `<userData>/capture-ca` (`CAPTURE_CA_DIR` dans `paths.ts`, droits par défaut du profil),
  hors de `bin/mitmproxy/` que la montée de version de mitmdump purge. Le dev ne change pas
  (`~/.mitmproxy` + `tools/capture/cert`).
- ✅ **Build** — `provisionProdCert` retiré de `fetch-binaries.mjs`, avec le téléchargement de
  mitmproxy au build qui ne servait qu'à elle ; `resources/prod-cert` retiré des `extraResources`.
  Garde `scripts/before-pack.mjs` (hook `beforePack` d'electron-builder) : refuse un config qui
  embarquerait `resources/prod-cert` (ou tout `resources/`), et signale un dossier `prod-cert`
  resté d'un ancien build — ignoré, jamais copié, supprimable.
- ✅ **Émulateur** — `capture.ps1` compare le **contenu** du cert du magasin système (SHA-256 via
  `sha256sum`, repli `toybox sha256sum`) à celui du fichier local, et non plus le seul nom (toutes
  les CA mitmproxy s'appellent `c8750f0d.0`) : absent ou différent → push + `bind_cert.sh`, puis
  revérification par empreinte. `bind_cert.sh` démonte d'abord un bind mount déjà posé, sinon la
  copie repartirait de l'ancien overlay (dont le dossier source est supprimé juste avant) au lieu du
  vrai magasin système.
- ✅ **Écoute locale** — mitmdump écoute sur `127.0.0.1` (et non plus `0.0.0.0`) : le trafic arrive
  par `adb reverse`.
- ✅ **Tests** — `capture-ca.test.ts` (faux mitmdump qui écrit les deux fichiers dans `confdir` :
  génération + copie en `c8750f0d.0`, réutilisation sans relancer mitmdump, `.0` restauré, appels
  concurrents, échec propre), `paths.test.ts` (`CAPTURE_CA_DIR` sous userData, hors installation),
  `packaging.test.ts` (aucun `extraResources` ne mappe `prod-cert`, garde câblé et testé).
- ⏳ **À valider sous Windows (LDPlayer)**, le PowerShell ne tourne pas sous Linux :
  1. émulateur qui porte l'**ancienne** CA (installée par une version précédente), app à jour :
     Arm capture → « Capture certificate ready » au premier lancement, puis « Replacing the MITM cert
     in the system store » (l'empreinte diffère), « MITM cert installed », et la capture aboutit
     (`user_item.json` écrit) ;
  2. Disarm puis second Arm → « MITM cert already in system store », rien n'est repoussé ni régénéré ;
  3. contrôle : `<userData>/capture-ca/` contient `mitmproxy-ca.pem`, `mitmproxy-ca-cert.pem`,
     `c8750f0d.0`, et le dossier `resources/` de l'installation n'a plus de `prod-cert`.

### 🖼️ Icônes de stat — déplacées sous `ui/stat/` sur R2 (2026-10-08)
- ✅ 🟡 **Les icônes de stat (`CM_Stat_Icon_*`) ne chargeaient plus nulle part.** Outerpedia les a
  déplacées de `equipment/` vers `ui/stat/` sur le bucket R2 (`images.ts` → `statIcon`) ; le solver les
  demandait toujours sous `/img/ui/effect/`, que `img-cache.ts` réécrit en `equipment/` → 404. Partout
  l'échec était muet (`StatIcon` masque l'image sur `onError`) ; seul l'en-tête du tableau talisman de
  Home (un `<img>` maison, sans garde) affichait des images cassées — d'où le signalement.
  `StatIcon` ([EquipmentIcon.tsx](../apps/renderer/src/design/EquipmentIcon.tsx)) pointe maintenant sur
  `/img/ui/stat/`, et l'en-tête talisman passe par `StatIcon` : le chemin n'existe plus qu'à un endroit.
  L'alias `ui/effect/*` → `equipment/*` reste, il sert toujours les icônes de set et d'effet unique.
  Non repris : `CM_Stat_Icon_VAMPIRIC` existe dans `ui/stat/` alors que `lifesteal` est déclaré sans icône.

### 🖼️ Icônes d'élément et de classe — nouveau set du jeu (2026-09-05)
- ✅ 🟡 **Le jeu a changé ses icônes d'élément et de classe** avec la sortie Steam (27/08) : nouveau set
  `IG_Turn_Element_*` / `IG_Turn_Class_*` (outerpedia les extrait, les sert dans `images.ts` et les a
  poussées sur R2 ; les anciens `CM_Element_*` / `CM_Class_*` restent sur disque mais ne sont plus ceux
  du jeu). Le solver pointait encore sur les anciens noms — 9 références basculées (`EquipmentIcon`,
  `HomeScreen`, `BuildsScreen`, `InventoryScreen`). Même casse de noms (Fire/Water/… ; Striker/Healer/…),
  aucun mapping à toucher. Non repris : les `CM_Sub_Class_*` (sous-classes, nouveau concept) — le solver
  n'affiche pas de sous-classe.

### 🎮 Source de capture Steam — plugin BepInEx (2026-09-05)
- ✅ 🟢 **Seconde méthode de capture, sans émulateur ni root ni proxy** — le client Steam d'OUTERPLANE
  (sorti le 27/08) est un build Unity **Mono**, non obfusqué côté réseau (mêmes hosts/ports/clé XOR
  que l'APK). Un plugin BepInEx (`tools/capture-steam/`, C#, 14 Ko) pose deux postfix Harmony sur
  `CWebManager` : `Log2InternalWeb(message, cmd)` — stub **vide** laissé par les devs, appelé sur
  chaque réponse OK avec le JSON **déjà déchiffré** + le path — et `DecryptMsg` en **fallback par
  forme** (clés racines : `ItemList`+`PresetList` → `user_item`, …) si le stub est inliné par le JIT.
  Il écrit les mêmes fichiers que `addon.py` (`user_item.json`, …, sentinel `.captured`,
  `_unknown/`, `seen-paths.log`) + un heartbeat `.steam-plugin.json` (pid, version, captures,
  `pathHook`). Lecture seule, I/O sur le thread pool, écriture atomique, cibles résolues **par nom**
  (un rename du jeu = erreur loggée, pas un crash).
- ✅ **Desktop** — `steam-capture.ts` (pur Node, partagé Vite/Electron) : détection registre
  `SteamPath` → `libraryfolders.vdf` → `appmanifest_4247320.acf` ; `installSteamPlugin()` télécharge
  BepInEx 5.4.23.5 (SHA-256 épinglé) si absent, copie le DLL, écrit `outerpedia.gearsolver.capture.cfg`
  avec `OutDir = CAPTURE_OUT` (autorisé jeu lancé tant que le plugin n'est pas chargé ; refusé si
  heartbeat live ou BepInEx à poser) ; `steamStatus()` = installé / BepInEx / plugin présent + à jour
  (hash) + bon dossier / jeu lancé (`tasklist`) / heartbeat → **live** ; `uninstallSteamPlugin()` ;
  `launchGame()` (`steam://rungameid`). Endpoints `/api/steam/{status,install,uninstall,launch}` dans
  `server.ts` + miroir Vite ; `download.ts` factorise download vérifié + `Expand-Archive` avec
  `mitm-provision.ts`. Packaging : `fetch-binaries.mjs` build le plugin (`npm run capture-steam:build`)
  → `resources/capture-steam/` → extraResources.
- ✅ **Renderer** — sélecteur de **source** (Settings → Setup, `gs.capture.source`, auto = Steam si le
  jeu est dans une bibliothèque Steam) ; wizard Steam 3 étapes (jeu trouvé / plugin installé / plugin
  live) avec Install / Launch / Remove ; header (`SteamBadge` + contrôles sans Arm/Disarm : Install
  plugin → Launch game → Reload) ; Home (CTA vide + System health par source, chip Live/Idle) ;
  **auto-import** : poll 5 s du statut + mtime de `user_item.json` quand la source est Steam → le
  compte se recharge seul en arrivant au lobby.
- ✅ **Validé en jeu** (build Steam 24947556) : plugin installé via `installSteamPlugin()`
  (`BepInEx/plugins/GearSolverCapture/`, cfg → `tools/capture/out`), relance du jeu → les deux hooks
  se posent, le **primaire** (`Log2InternalWeb`) tire réellement (`pathHook: true`, le stub n'est pas
  inliné par le JIT Mono), 9 endpoints écrits (`user_item` 619 Ko, `user_character`, `user_archive`,
  `user_gift`, …), auto-import de l'app au lobby sans clic, codex + geas importés à l'ouverture des
  écrans. Reste (todo) : chemin « BepInEx absent » à tester sur une install vierge, liaison compte
  mobile ↔ Steam à confirmer côté MAJOR9.

### 🎯 Colonne Damage = hit du meilleur skill (2026-09-05)
- ✅ **`dmg` / `dmgs` / `mcd` / `mcds` × facteur du meilleur skill** — la colonne Dmg du
  Builder calculait un hit à facteur de skill implicite 100 % ; elle affiche maintenant le
  hit attendu du skill le plus puissant du perso (max sur S1/S2/S3 au **niveau max**, bursts
  1..3 inclus quand ils remplacent le skill burstable ; multi-hit = somme des hits).
  `computeCheapRatings(…, skillFactor)` (5ᵉ paramètre, défaut 1) applique le facteur APRÈS
  `dmgStat`/`dmgSec`/`noCrit` ; `dmgh` reste la référence HP à 100 %. Constante par perso →
  **classement mono-perso inchangé** (test d'invariance d'ordre sur 5 builds × 4 ratings ×
  3 facteurs). Repli EXPLICITE `lib/dmgSkill.ts` : sans donnée → ×1,00 + tooltip ⚠ + badge
  ambre « ×1 » (jamais un 0 silencieux). Le gagnant (S1/S2/S3, « B1..B3 ») est affiché en
  badge dans l'en-tête Dmg/DmgS et dans les tooltips (`ratingTitle`), « approximate » si
  chaîne de hits irrésolue. Assumé : DoT non modélisés (Gnosis Beth sous-estimée), pas de
  buffs/chaînes. 4 tests `dmgSkill.test.ts` + 4 dans `solver.test.ts`.
- ✅ **Source = pipeline, pas de parsing local** — outerpedia `datagen/generators/solver.ts`
  émet `bestSkill { slot, burst?, factor ‰, unresolvedHits? }` par perso, calculé par
  `solver-best-skill.ts` depuis l'extracteur damage du même build et la règle du moteur
  `stateTotalFactor` (extraite de `report.ts` — clips résolus → Σ events, sinon Σ tables
  comblée à 1000 sous 990). Diff des artefacts solver limité au nouveau champ (125/125
  persos, 25 gagnants burst, 4 irrésolus signalés). `npm run data:sync` → `data/derived/`
  (version `9ad224f781ad`). Validé contre `buildSkillReport` (DEF 2000, crit 0 %) : Rhona S3
  ×1,67, K S2-B1 ×2,39, Primine S1 ×0,86 — exacts.
- 📝 **TODO ouvert** : DPS de rotation pondéré par les cooldowns (`levels[].cool` /
  `startCool` déjà dans la donnée damage) — hors périmètre, cf. todo.md.

### 📤 Export roster « hero-tracker » (2026-08-13)
- ✅ **Bouton Export dans Home → Roster** (à droite du titre) — écrit un JSON
  `outerpedia:hero-tracker` v1 : un objet par héros possédé, indexé par **l'ID de base**
  (jamais le `27xxxxx` fusionné), avec `level` / `skills{s1,s2,s3,chain_passive}` /
  `affinity` / `transcend_star` / `ee` / `core_fusion{level,ee}`. Progression seule :
  pas de gear, pas de stats, pas d'inventaire. Logique pure dans
  `apps/renderer/src/lib/heroTracker.ts` (+ 11 tests) ; chaque champ est clampé dans le
  domaine du jeu, plancher `transcend_star` = rareté de base. Le bouton est désactivé
  sans capture et flashe Saved/Failed.
- ✅ **`FusionLevel` remonté jusqu'au type `Character`** (`raw.ts` le déclare, `parse.ts` le
  lit) — il n'était pas parsé, donc le palier de core fusion était inaccessible côté UI.
- ✅ 🔍 **`TransStar` confirmé correct, pas un plafond** — l'export sortait 9 pour les 119
  héros, soupçonné faux. Croisement sur toute la capture : le champ vaut 3, 5 et 9 chez
  les adversaires PvP du même payload → c'est bien la transcendance courante, et le compte
  est simplement full 6★. Mapping interne→affiché (5 = 4★+1, 6 = 5★, 9 = 6★) vérifié contre
  `showUIStar`/`starPlus` de `characters.json`. Documenté dans data-schema.md pour couper
  court au prochain doute.

### 🔧 Migration de la source de données — outerpedia (2026-08-12)
- ✅ 🔴 **Le solver ne voyait plus les nouveaux persos** — la sync pointait sur le repo mort
  `Sevih/outerpediaV2` (et des checkouts locaux disparus) : `data/game` était figé à 322 persos quand
  le jeu en avait 337. Cause : migration du site vers `Sevih/outerpedia` (layout refondu, tables
  brutes gitignorées dans `.gamedata/`).
- ✅ **Nouvelle chaîne de données** — la distillation (`build.mjs` + `calc-stats.mjs`) est portée
  dans outerpedia (`datagen/generators/solver.ts`, commit 387a58c côté outerpedia) qui committe les
  19 artefacts à `data/generated/solver/`. Côté solver : `data-sync.ts` réécrit en simple
  téléchargement SHA-gaté (checkout local ou CDN GitHub), plus aucun rebuild client ;
  `data/sync.mjs` remplace `sync.ps1`+`build.mjs` pour rafraîchir le `data/derived` committé
  (`npm run data:sync`) ; artefacts re-sérialisés compacts à la sync (le generator émet indenté,
  ~2,6× plus gros). `data/game/`, `build.mjs`, `calc-stats.mjs`, `sync.ps1` supprimés du repo et
  du packaging. Download REPO tout-ou-rien (jamais de snapshot mi-vieux/mi-neuf).
- ✅ **Images via le bucket R2 `img.outerpedia.com`** (le nouveau site ne committe plus d'images) —
  `img-cache.ts` cascade sprites bundlés → checkout `.assets-staging/images` (dev) → cache disque →
  R2 ; alias de namespace `ui/effect/*`→`equipment/*` (layout V2 → R2) ; les 10 sprites `ui/inven/*`
  absents de R2 sont bundlés dans `apps/renderer/public/img/` ; préfetch piloté par la donnée
  dérivée (icônes d'équipement référencées) au lieu de l'arborescence GitHub ; CSP img-src resserrée
  à `'self'` (plus de 302 externe). Reco-proxy inchangé (`/api/reco/:id` existe sur le nouveau site).
- ✅ **Données à jour** — `data/derived` resynchronisé (125 persos dont Lambda/Saeran/H.Delta,
  3134 items, hash `f872e2e94b4a`). Typecheck + 289 tests verts ; sync CHECKOUT (froid + idempotence)
  et REPO (download @ 387a58c) smoke-testés.

### 🔴 Bugs — audit Builder (2026-07-03)
- ✅ 🔴 **Deadlock UI : changer `workerCount` pendant un solve** — l'effet `useEffect([workerCount])`
  (`BuilderScreen.tsx`) disposait le pool sans flush ni reset : `onResult` ne venait jamais, l'écran restait
  en « solving… » avec un Cancel no-op (ref nulle). Fix : `setSolving(false)` + reset du progress dans l'effet.
- ✅ 🔴 **`computeScore` ne clampait pas PEN à 100 %** — seul CHC était clampé (check `critRate` en dur) alors
  que le registre marque `pen` `capAt100` et que le modèle de dégâts plafonne PPR (§1.2) ; un build à 115 % PEN
  gagnait du score fantôme. Fix : clamp piloté par `SCORE_CAP_100` (dérivé du registre — enfin branché, il
  était exporté sans consommateur), donc un futur axe cappé ne peut plus rater le clamp. +1 test
  (`solver.test.ts` : PEN cappé, axes non-cappés inchangés).

### 🟡/⚪ Cas limites — audit Builder (2026-07-03)
- ✅ 🟡 **Cancel non réactif dans les sous-arbres massivement élagués** — le tick de `solveChunk` ne comptait
  que les feuilles talisman : un parcours armor N⁴ entièrement rejeté (feasibility / no-broken-sets) ne
  drainait jamais la file de messages → Cancel ignoré des secondes. Fix : compteur `steps` incrémenté aussi à
  chaque nœud boots (avant `incSet`, tally cohérent en cas de break) — l'écart max entre ticks est borné par le
  produit N³ helmet×armor×gloves.
- ✅ 🟡 **Plan de sets infaisable (> 4 slots) créable dans l'UI** — `cycleSetInPlan` ne bornait pas `Σ count`
  (`2pc A + 2pc B + 2pc C` = 6 slots → le moteur skippe le plan, pools vidés, `emptyReason` accusait « les
  filtres »). Fix : le cycle saute tout step qui dépasse les `ARMOR_SLOTS` restants du plan
  (`nextPlanCount(cur, reach, slotsFree)`), les tooltips des chips annoncent « no room left in this plan », et
  un bandeau rose signale un plan > 4 slots importé d'un preset/reco legacy.
- ✅ ⚪ **`worker.onerror` non gaté** — un crash DOM tardif d'un run périmé pouvait afficher une bannière
  d'erreur sur le run courant ; et un crash pendant un solve actif laissait `workersDone` ne jamais atteindre
  `activeChunks` (UI en attente infinie). Fix : gate sur `active` + `cancel()` (flush des partiels, UI libérée).

### 🟠 Perf — audit Builder (2026-07-03)
- ✅ 🟠 **Alloc gem cap-aware mémoïsée par `preGemCrc`** — le slow path crit-cap (`wantCritCap`) et
  l'anti-overshoot re-lançaient l'allocateur (tableaux frais + parcours du pool) à **chaque combo**, alors
  que le résultat est pur en (pool constant, slots constants, `preGemCrc`) et que le CHC pré-gemme ne prend
  qu'une poignée de valeurs distinctes sur des millions de combos. Cache `capAllocCache` par run
  `solveChunk`, keyed `(talismanSlots, preGemCrc)` (offset numérique, floats exacts en Map). L'anti-overshoot
  gagne aussi le check `gemDeltaEquals` avant recompose (miroir du chemin cap-reaching — une allocation
  identique au greedy par défaut ne recompose plus pour rien).
- ✅ 🟠 **Estimation pré-solve hors main thread** — le `precomputeContext` debounced du garde-fou (reforge-sim
  + ranking CP par pièce + dominance O(n²) en mode CP = 100 ms+ de jank par édition de filtre sur gros
  inventaire) tourne maintenant sur un **worker d'estimation dédié** de l'orchestrateur (message `estimate`
  hors cycle de solve : id anti-stale, latest-wins, un échec rend `null` → bandeau masqué, jamais d'erreur ;
  worker séparé du pool pour ne pas payer W clones de game/inventaire au pick du héros — un seul init).
- ✅ 🟠 **Partition : slot externe préféré** — `pickPartitionSlot` tranchait le plus gros pool ; quand c'était
  le **talisman** (boucle interne, fréquent), chaque worker re-parcourait tout l'arbre weapon..accessory et
  re-payait ×W le travail hoisté par nœud accessory (set tallies, `computeSetBonuses`,
  `aggregatePrefixBuckets`). Désormais : le slot le plus **externe** dont le pool ≥ 4× le nombre de chunks
  (slices ⌈N/W⌉ équilibrées à ≤ 25 %), fallback plus-gros-pool. +1 test d'équivalence union-des-chunks ==
  mono-chunk (`solveChunk.test.ts`).
- ✅ 🟠 **Throttle global du progress** — chaque worker postait ~toutes les 100 ms et chaque message
  déclenchait `onProgress` → jusqu'à ~300 setState/s à 30 workers. L'orchestrateur agrège et émet à ≤ ~10 Hz
  (`PROGRESS_EMIT_MS`) ; compteurs cumulatifs donc rien de perdu, et `flush()` émet les **totaux exacts**
  (le footer P/S ne rate plus les derniers incréments avalés par le throttle — petit fix au passage).
- ✅ ⚪ **Nits** — `keepTopPct` sans appelant prod retiré du moteur (déplacé en helper local de
  `cpPrune.test.ts` pour garder la sémantique % verrouillée) · l'inline `enhanceLevel >= 5 ? 5 : 4` de la hot
  loop appelle `gemSlotsOf` · `TopKHeap` calcule `heapKey` une fois au push et stocke `{key, build}` (les
  sifts comparent un nombre).

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

## [Unreleased]

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.10.0] — 2026-10-17

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.9.0] — 2026-10-16

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.8.1] — 2026-10-08

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.8.0] — 2026-09-05

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.7.0] — 2026-08-13

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.6.0] — 2026-08-12

### Session 2026-07-10 — 🤖 Auto-submit VirusTotal au release (outillage)

- `scripts/release.mjs` : quand **`VT_API_KEY`** est présent, l'étape 5 upload l'installeur sur
  VirusTotal (API v3, flux `upload_url` pour les fichiers > 32 Mo) et injecte le **lien du scan**
  (`gui/file/<sha256>`) dans les notes de release. Best-effort : une panne VT ne fait jamais échouer
  le release (skip si clé absente, catch non fatal sinon). Résultat du switch AV : la 1.5.6 sort à
  **0/66 sur VirusTotal** (la détection Varist `W64/ABApplication` a disparu ; le score 60.9 restant
  est le *risk rating* comportemental d'Electron, pas une détection).

## [1.5.6] — 2026-07-10

### Session 2026-07-10 — 🔴 Fix : extraction mitmproxy au premier lancement (régression 1.5.5)

- 🔴 **`Expand-Archive failed on the mitmproxy zip`** en prod juste après le checksum OK : le fichier
  téléchargé était nommé `download.zip.partial`, or **PowerShell `Expand-Archive` refuse toute
  extension ≠ `.zip`** (« Le seul format pris en charge est .zip »). Reproduit et confirmé sur le vrai
  zip (`.partial` → exit 1, `.zip` → exit 0, mitmdump.exe extrait). Fix : nom en `download.zip` +
  `$ErrorActionPreference='Stop'` et remontée de la 1re ligne de stderr dans le message d'erreur
  ([mitm-provision.ts](../apps/desktop/src/mitm-provision.ts)). Le build (`fetch-binaries.mjs`) n'était
  pas touché car il utilisait déjà un nom en `.zip`.

## [1.5.5] — 2026-07-10

### Session 2026-07-10 — 🛡️ mitmproxy téléchargé au runtime (installeur non flaggé AV)

- **Problème** : l'installeur NSIS embarquait les binaires mitmproxy (`resources/bin/mitmproxy/`) ;
  VirusTotal remontait 3/63 détections (Varist classait `mitmweb.exe` en `W64/ABApplication` PUA,
  DrWeb suivait avec une signature générique `Trojan.Siggen31`). Cause réelle confirmée par le rapport
  Varist : c'est bien l'exe mitmproxy embarqué qui est flaggé, pas une heuristique sur l'installeur.
- **Fix** : mitmdump n'est plus bundlé. Nouveau [mitm-provision.ts](../apps/desktop/src/mitm-provision.ts) —
  au **premier** « Arm capture », l'app télécharge le zip officiel depuis `downloads.mitmproxy.org`,
  **vérifie le SHA-256** épinglé, puis extrait **uniquement** `mitmdump.exe` sous
  `<userData>/bin/mitmproxy/<version>/` (dir versionné → un bump de version re-provisionne tout seul).
  La progression passe par la console de capture ([server.ts](../apps/desktop/src/server.ts) `/api/capture/run`).
- `package.json` : `extraResources` ne bundle plus que `resources/bin/adb` (au lieu de `resources/bin/**`).
- `fetch-binaries.mjs` reste build-only (génère la CA prod en lançant mitmdump) mais **vérifie le hash**
  et supprime `mitmproxy.exe` / `mitmweb.exe` après extraction — plus de bait AV dans l'arbre de packaging.
  Version + hash épinglés en double, à garder synchronisés entre `mitm-provision.ts` et `fetch-binaries.mjs`.
- **Note** : `adb.exe` reste bundlé (non flaggé) ; le pipeline dev (`tools/capture/*.ps1`) est inchangé
  et utilise toujours le mitmproxy installé système.

### Session 2026-07-10 — 🔎 Transparence / vérifiabilité (installeur non signé)

- `scripts/release.mjs` : hash l'installeur après le build electron-builder et publie un bloc
  **SHA-256 + commande `Get-FileHash`** dans les notes de release GitHub (fallback inclus quand il n'y
  a ni notes curées ni commits, pour que chaque release porte quand même un checksum vérifiable).
- `README.md` : section « Antivirus / SmartScreen warnings » expliquant l'absence de signature, le
  pourquoi des avertissements (pilotage émulateur + interception HTTPS via mitmproxy = comportement
  qui ressemble à du monitoring), le téléchargement mitmproxy vérifié, et comment vérifier le hash.
- Piste restante (gratuite, gros impact) : signature de code via **SignPath Foundation** (certificat
  gratuit pour projets OSS) — nécessite candidature + migration du release vers GitHub Actions.

## [1.5.4] — 2026-07-05

### Session 2026-07-04 — ⚪ Label : « Effect Resistance » → « Resilience »

- `longLabel` de `effRes` ([tokens.ts](../apps/renderer/src/design/tokens.ts)) : le jeu appelle la stat
  **Resilience**, pas « Effect Resistance » (jargon d'autres gachas). Seule occurrence fautive — le panneau
  Damage/+1% disait déjà Resilience ; label court « RES » inchangé.

## [1.5.3] — 2026-07-03

### Session 2026-07-03 (soir) — 🟢 Solver : recall du prune (Top % 60) + collapse talisman

- **Collapse des variantes talisman dans les résultats** (`collapseTalismanVariants`,
  [engine.ts](../apps/renderer/src/lib/solver/engine.ts), appliqué au merge de l'orchestrator **avant**
  la tranche top-N) — retour terrain : le top-1000 était régulièrement le même combo 6-gear × des dizaines
  de talismans quasi identiques (les gemmes sont une allocation globale → les variantes ne diffèrent presque
  que par le main du talisman), noyant les builds réellement différents. Max **3 builds par signature
  6-gear** (weapon..accessory + EE) ; les talismans alternatifs restent visibles aux rangs 2-3. Le buffer
  mergé (workers × topK) est collapsé puis tranché → les places libérées vont à d'autres combos. +3 tests.
  Investigation associée « gemmes crit > 100 % » : l'allocateur est bien cap-aware sur les chemins actifs
  (dépassement > 102 % → réallocation cappée ; 100-102 = la gemme qui franchit le cap, utile) — les cas
  restants sont les gemmes **capturées** socketées (aucune allocation solveur → gardées telles quelles) et
  le CHC combat (buffs conditionnels) vs feuille. À réexaminer sur repro avec priorités actives.
- **Top % : défaut 30 → 60** — retour terrain : à 30 le vrai meilleur build se trouvait régulièrement
  juste au-delà de la tranche élaguée (l'utilisateur « corrigeait » en empilant des stat filters, qui
  rétrécissent les pools avant le budget). Le budget étant normalisé à `8M × topPct/30`, 60 → ~16 M
  combos parcourus (quelques secondes) pour un recall nettement meilleur ; 100 reste l'exhaustif.
  Docs recalées (solver.md, wiki/Solver.md, commentaire engine).

## [1.5.2] — 2026-07-03

### Session 2026-07-03 — 🔴 Solver : réservations worklist + refonte « Maxed only » (+ nit ≤ Lower)

- **Le solver ignore la worklist** (bug/QoL) — solve du héros B après avoir mis le build de A en worklist :
  les pièces réservées par A restaient « libres / volables ». **Fix** : `worklistClaims(list, inv)`
  ([worklist.ts](../apps/renderer/src/lib/storage/worklist.ts)) dérive live `uid → héros réclamant`
  (changes **non appliqués** seulement ; l'entrée la plus récente gagne un double-claim), threadé
  App → Builder → orchestrator/estimate → engine. Dans `allow()` + `buildGemPool`, le **propriétaire
  effectif = claim ?? equippedBy** → le scope « Equipped items » + rank s'appliquent aux réservations
  **comme au gear réel** (`≤ Lower` : un héros mieux classé peut encore prendre la pièce réservée d'un
  moins bien classé ; `None` : jamais ; `All` : claims ignorés comme l'équipement). Appliquer/retirer
  l'entrée libère les claims automatiquement. +6 tests (`worklistPlan` : helper ; `solver` : gem pool
  avec réservations, claim par le héros lui-même = own gear).
- **« Maxed only » repensé — mode-aware, zéro extrapolation** — l'ancien toggle coupait
  `enhanceLevel < 15` quel que soit le mode reforge (en +10R6 il jetait le gear endgame +10).
  **Nouvelle sémantique** : le mode reforge devient un **plancher d'investissement** — seules les
  pièces **déjà** à cet état (ou mieux) entrent, notées sur leurs **vrais rolls** (projection sautée,
  gear cards comprises — contexte d'affichage snapshoté en `disable`). Planchers : Off → aucun ·
  +10R6 → enhance ≥ 10 & ≥ 6 reforges · +10R9 → ≥ 10 & ≥ 9 · +15R9 → +15 & ≥ 9. « Ou mieux » garde
  ses meilleurs rolls (pas de down-scale d'une +15 au plafond +10). Talisman : enhance seul ; EE
  jamais filtré. Helpers purs `maxedFloorOf`/`meetsMaxedFloor`
  ([engine.ts](../apps/renderer/src/lib/solver/engine.ts)) + tooltip sur le toggle. +5 tests
  verrouillant la table des planchers.
- **⚪ Bouton « ≤ Lower » sur 2 lignes** (segmented Equipped items, panneau Options) — l'espace
  sécable du label wrappait dans le panneau étroit → `whitespace-nowrap` + `shrink-0`.
- Docs synchronisées ([solver.md](solver.md) phase 2 + Options, [wiki/Solver.md](../wiki/Solver.md),
  [wiki/Using-the-App.md](../wiki/Using-the-App.md), `types.ts`). Typecheck + 286 tests verts.

## [1.5.1] — 2026-07-03

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.5.0] — 2026-07-03

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.4.0] — 2026-07-02

### Session 2026-07-02 — 🔴 Solver : `min` de stat rendu infaisable par le prune + tri Builds explicite

- **Bug — un `min` de stat exigeant renvoyait 0 build** ([engine.ts](../apps/renderer/src/lib/solver/engine.ts)
  `keepTopUnion`). Le prune combo-budget (avant le cartésien) classe chaque slot par le **score objectif** (somme
  pondérée de la priorité — ex. spd+chc+eff). Une pièce forte en spd mais nulle en eff sort devant une pièce eff
  modérée → les pièces eff tombent → aucun build n'atteint le **plancher eff 570** → aucun résultat, alors que
  forcer un set 2pc-eff (qui whitelist ces pièces) en trouvait. **Fix** : le prune garde par slot **l'union du
  top-objectif ET du top de chaque stat sous contrainte `min`** (un scorer par stat min, via `priorityScoreOf`
  avec un poids unitaire). Budget réparti sur objectif + scorers → **union ≤ budget par slot**, donc `∏ keep`
  reste borné (pas de hang). Avec ≥1 pièce gardée par slot par stat min, le **max atteignable de chaque stat
  contrainte survit** au prune → plancher atteignable dès que le pool complet le permettait. Appliqué aux 3
  branches (priorité / CP / magnitude) ; seuls les `min` comptent (un `max` est honoré par le filtre in-loop).
  Sans filtre min → identique à avant. +3 tests `cpPrune.test.ts`.
- **Tri Builds « CP / Rank » explicite** ([BuildsScreen.tsx](../apps/renderer/src/screens/BuildsScreen.tsx)) — le
  tri par rang existait déjà mais via un **unique bouton toggle « # Rank »** noyé dans la rangée « Filter » (se
  lisait comme un filtre ; CP, le défaut, sans indicateur). Remplacé par un **segmented « Sort : CP | Rank »**,
  même état `byRank` (persistance conservée), les deux options visibles.

### Session 2026-06-30 — 🔧 Tooling : notes de release GitHub face-joueur (fichier dédié)

Les releases GitHub n'affichaient que « chore: release vX.Y.Z » — aucune note. Première passe : j'avais
branché **ce changelog** comme source → mais il est en **français** et plein de détail dev (noms de fichiers,
`npm run dev`, nombres de tests) — illisible pour un joueur. Corrigé : un **fichier dédié, anglais,
face-joueur** porte les notes publiques ; ce changelog reste le **journal dev** non publié.

- **[`docs/release-notes.md`](release-notes.md)** (nouveau) — notes **curées, en anglais, orientées
  utilisateur** (ce qui change pour le joueur, zéro jargon). Section `## [Unreleased]` au sommet où l'on écrit
  les notes de la prochaine version ; **c'est la source des notes GitHub**.
- **`scripts/release.mjs`** : lit `[Unreleased]` de `release-notes.md` **avant** de la tamponner
  (`readUnreleasedNotes`), tamponne les **deux** journaux (`stampUnreleased` × release-notes + changelog →
  `## [X.Y.Z] — date` + `[Unreleased]` vide), les commit avec le bump, et **publie la section anglaise comme
  notes GitHub** (`gh release edit --notes-file`). Fallback sur les sujets de commits si vide.
- **Changelog versionné** : ce fichier garde la structure `## [Unreleased]` / `## [1.3.0]` / `## [1.1.1]` /
  `## [≤ 1.1.0]` (tamponné en parallèle), mais **n'est plus publié**.
- **Process** : entrées dev FR ici, notes joueur EN dans `release-notes.md` ; `npm run release minor` tamponne
  et publie les deux.

## [1.3.0] — 2026-06-30

### Session 2026-06-30 — 🟠 Retours terrain (install en direct) + ergonomie Builder

Observé une install/capture en temps réel chez quelqu'un — deux frictions, plus quelques ajustements UX.

- **Timeout Arm capture 150s → 360s** ([`capture.ps1`](../tools/capture/capture.ps1) `$TimeoutSec`) — un
  **premier** lancement du jeu (patch + login) peut prendre ~5 min ; 150s était trop court. Au-delà du
  timeout le pipeline **reste armé** de toute façon (la capture se fait quand le lobby charge, le status poll
  récupère le sentinel).
- **Worklist — lignes enrichies** ([`WorklistScreen.tsx`](../apps/renderer/src/screens/WorklistScreen.tsx)) :
  le **nom seul ne permet pas d'identifier** une copie physique. Chaque ligne affiche désormais, résolu
  **live** depuis l'inventaire (`toUid`) : **image** de l'item (`EquipmentIcon`, étoiles/enhance), **stats**
  (main(s) + substats), et **localisation actuelle** (portrait + nom du perso qui le porte, ou « in
  Inventory »). Maps `pieceByUid`/`charByUid` (depuis `inventory.gear` + `inventory.characters`). Statut
  « gone » ajouté pour une pièce disparue ; le `c.toMain` stocké devient redondant (stats live).
- **Bouton SOLVE par défaut « Solve » (score), non persisté** ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) —
  `usePersistedState("gs.builder.solveMode", "cp")` → `useState("score")`. Chaque ouverture repart sur
  « Solve » au lieu de mémoriser un « Solve CP » précédent.
- **Damage / +1% — égalités colorées** : le panneau ne coloriait que la stat de plus haut gain ; il colore
  maintenant **toutes les stats à poids égal** (même `+X.XX%` affiché, comparaison sur la précision affichée).
- **`npm run dev` = `npm run desktop:dev`** ([`package.json`](../package.json)) — `dev` délègue au lancement
  full desktop (Vite + Electron). Le renderer seul reste via `npm run dev -w @gear-solver/renderer`.

## [1.1.1] — 2026-06-29

### Session 2026-06-29 — 🟢 Builder : cartes résultat alignées sur l'Inventaire + carte « Effects »

Refonte des **gear cards des résultats SOLVE** (bandeau du bas) pour qu'elles aient l'apparence de la carte
détail de l'Inventaire, puis dégraissage + agrégation des effets de build.

- **Fork de la carte Inventaire** ([`ResultGearDetail.tsx`](../apps/renderer/src/design/ResultGearDetail.tsx),
  nouveau) — duplicata isolé de `GearDetailBody`/`ItemDetail` (`ResultGearDetailBody` / `ResultItemDetail`)
  pour pouvoir « pimper » les cartes résultat sans toucher l'Inventaire. La gear card du Builder rend ce fork
  via le même `toUiPiece` (portrait du héros équipé **en haut-droite, rond** · footer Exclude câblé App →
  Builder → band).
- **Dégraissage** (carte résultat) : image −30 %, qualité réduite au `current/max + label` coloré, **substats
  `LV n (Base + Actuelle + Extrapolé)`** (l'extrapolé de la projection en cyan, via `addedTicks` threadé),
  effet d'item = juste la desc, passif singularity sans le libellé « Active Effect at +15 », **EE** = image +
  gems uniquement, nom sur 2 lignes avec dégradé singularity **vertical**, ligne rareté/slot retirée, mains à
  droite de l'icône.
- **Carte « Effects »** ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)
  `BuildEffectsPanel`, sous le panneau stats) — agrège **passif d'arme + d'accessoire + effets de set actifs**
  (icône + nom, **desc au survol**). Hover via un nouveau [`HoverCard.tsx`](../apps/renderer/src/design/HoverCard.tsx)
  (toute la ligne survolable, popover en portal). Ces effets sont **retirés des gear cards** (le passif
  singularity y reste).

### Session 2026-06-29 — 🔴 Fixes Builder résultats (reforge / gemmes / singularity / étoiles)

- **Compteur de reforge non mis à jour** → qualité impossible (`19/14 Perfect`). `simulateReforges`
  ([`engine.ts`](../apps/renderer/src/lib/solver/engine.ts)) pose maintenant `reforgeCount = budget` sur la
  pièce projetée → qualité `current / (14 + budget)` (ex. `23/23`, ou `19/23` si des subs plafonnent à LV6).
  Purement display (le `reforgeCount` n'entre pas dans le CP/score).
- **Étoiles de l'item par reforge** — corollaire du fix ci-dessus : `iconPiece.reforge = reforgeCount` →
  `splitStars(6, 9)` = **6 étoiles violettes** (singularity) à 9 reforges, **orange** à 6. Donc **violet à
  +9, orange sinon**, sans code supplémentaire.
- **Lettre de grade colorée du passif singularity** absente sur pièce projetée — `addProjectedSingularity`
  posait le `name` mais pas la `desc` rich-text. Ajout du `desc` verbatim du top-grade (`S+` magenta, ids
  300126 / 310066 de `singularity-options.json`) → GameText rend la lettre colorée comme une vraie pièce.
- **Gemmes EE/talisman vides** — la carte montrait les gemmes *socketées capturées* au lieu de l'**allocation
  du solver** (en CP). Override des `gemSlots` de la pièce gem-bearing par `build.gemAllocation` (slot-aligné)
  avant l'adaptation. Fallback sur les gemmes capturées si le solver n'en alloue aucune.
- **Analyse « Ether Blade gagne le CP » → pas un bug.** Le CP est stat-only et ignore les passifs (effets
  conditionnels de combat) ; les 2 mains d'une arme sont fixées par star+slot (identiques entre armes du même
  star), donc le solver départage sur les **substats projetés**. Une arme qui troque de l'ATK contre HP/crit/
  SPD peut légitimement sortir devant selon le héros. Conclusion : comportement attendu, aucun changement.

### Session 2026-06-29 — 🟢 Reforge : 4e mode « +10R9 » + libellés enhancement/reforge

Le segmented control Reforge n'offrait que **+10 (classic)** et **+15 (ascended)** — il manquait le
palier d'investissement **réel et rentable** : ascender une pièce (50 high-precision chips) débloque les
**+3 reforges** ET le +15, mais pousser +10→+15 coûte *bien plus* (chips à 90/80/70/60/40 % de réussite).
Beaucoup de joueurs ascendent pour les reforges et s'arrêtent à +10.

- **Nouveau mode `ascended10`** ([`engine.ts`](../apps/renderer/src/lib/solver/engine.ts) `REFORGE_PLANS`) —
  **même plafond +10 que `classic`** (main stat identique) mais **budget 9 reforges** au lieu de 6.
  **Crucial** : l'ascension ne donne PAS le passif de singularité — celui-ci (DMG± inconditionnel) **se
  débloque uniquement au +15**. Donc `ascended10` reste `ceiling.ascended: false` (main +10) et le passif
  est gaté sur `ceiling.ascended`, exclusif à `ascended` (+15). +4 tests (`solver.test.ts` : budget 6/9/9
  par mode, absence de passif en `ascended10`).
- **Libellés repensés** ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)
  `REFORGE_MODES`) — **Off / +10R6 / +10R9 / +15R9** (enhancement + nombre de reforges), bien plus
  parlants que classic/ascended. Badge de carte + `projLabel` mis à jour, défaut inchangé (`classic` =
  +10R6). Ids internes (`classic`/`ascended`) conservés → presets/builds sauvés rétrocompatibles ; seul
  `ascended10` est nouveau (aucune migration).
- Docs synchronisées ([solver.md](solver.md), [wiki/Solver.md](../wiki/Solver.md), `types.ts`). Typecheck
  + build + 248 tests verts.

## [≤ 1.1.0] — historique (2026-06-28 et antérieur)

### Session 2026-06-28 — 🟢 Capture : support multi-émulateur (générique + override manuel)

La capture ne ciblait que 3 marques codées en dur (LDPlayer/MuMu/Nox, chemins adb + ports). Élargi pour
fonctionner avec **n'importe quel émulateur rooté**, sans toucher au mobile (limite root, hors scope ici).

- **Détection générique** ([`emulator-detect.ts`](../apps/desktop/src/emulator-detect.ts)) — le serveur ADB
  est partagé (port 5037), donc `adb devices` liste **toute** instance connectée, marque inconnue comprise.
  Nouveau `resolveCaptureTarget(manual, fallbackAdb)` résout la cible par priorité : **override manuel** →
  **marque connue en cours** → **générique** (`adb devices` via l'adb d'une marque ou l'adb bundlé) →
  marque installée-mais-éteinte. `targetScriptArgs` produit les `-Device`/`-Adb` partagés dev+prod.
- **Override « Manual device »** — `loadManualDevice`/`saveManualDevice` (fichier `manual-device.json` sous
  `.cache` en dev / `userData` en prod, [`paths.ts`](../apps/desktop/src/paths.ts) `MANUAL_DEVICE`) + endpoints
  `GET`/`POST /api/capture/manual-device` (miroir [`server.ts`](../apps/desktop/src/server.ts) +
  [`vite.config.ts`](../apps/renderer/vite.config.ts)). Court-circuite l'auto-détection : adb path + device
  saisis à la main pour forcer un émulateur hors-profil.
- **`preflight` cible-aware** — réécrit pour honorer override + générique tout en gardant les 4 checks
  (installed / running / adb / root) ; le check « running » TCP-probe le port pour un `host:port`, sinon
  considère un serial listé comme présent. `captureScriptArgs`/`detectArgs` passent par le même resolver.
- **UI wizard** ([`SettingsModal.tsx`](../apps/renderer/src/design/SettingsModal.tsx)) — section repliable
  **Manual device** (champs adb.exe + device, Save & re-check / Clear, badge « active »/« using manual
  override »), copies d'install mises à jour (« autres émulateurs supportés — auto-détectés ou via Manual
  device ; physique pas encore »). Typecheck renderer + desktop, build, 244 tests verts. **À valider en
  runtime sur un vrai émulateur non-LDPlayer** (code desktop non testable hors app).

### Session 2026-06-28 — 🟢 Worklist : transaction ordonnée inter-entrées (Apply all)

La worklist signalait les conflits (« contested ») mais laissait l'utilisateur **arbitrer l'ordre à la
main** ; pas de « tout appliquer ». Ajout d'un **planificateur de transaction** pur + d'un **Apply all**
atomique multi-héros.

- **Planificateur** ([`lib/worklist/plan.ts`](../apps/renderer/src/lib/worklist/plan.ts),
  `planWorklist(list, inventory)`) — dérivé live du snapshot :
  - **Contention** : un uid ciblé par ≥2 héros distincts = une seule copie physique disputée → `contended`,
    **insoluble par l'ordre** (l'utilisateur retire/retarge une entrée). Bloque Apply all.
  - **Ordre free-before-use** : arête A→B quand A **libère** (`fromUid` sur son héros) une pièce que B
    **réclame** (`toUid`) ; tri topologique (Kahn, ties par ordre d'origine) → `order` + `position` 1-based.
  - **Cycles** : A libère ce que B veut *et* réciproquement → aucun ordre humain valide ; marqués `cyclic`
    (« ↻ »), **toujours applicables atomiquement** (sémantique de vol d'`equipItem` rend l'état final
    indépendant de l'ordre pour un batch cohérent). +7 tests `worklistPlan.test.ts`.
- **Apply atomique multi-héros** ([`equip.ts`](../apps/renderer/src/equip.ts) `equipAssignments`) — fold
  d'`equipItem` sur des moves `{uid → heroUid}` hétérogènes en **une** réécriture de snapshot.
- **UI** ([`WorklistScreen.tsx`](../apps/renderer/src/screens/WorklistScreen.tsx)) — barre d'en-tête
  « N changes across M heroes » + bouton **Apply all** (désactivé tant qu'il y a contention), bannière
  ambre listant les pièces contestées, badge d'ordre par carte (numéro cyan « step N » quand des
  dépendances existent, « ↻ » pour un cycle). Le « Apply locally » par carte reste pour le grain fin.
  Typecheck + build + 244 tests verts.

### Session 2026-06-28 — ⚪ Tint doré d'un sub : seuil réel = 6 reforges

Le tint doré de [`SubstatRow`](../apps/renderer/src/design/GearDetail.tsx) utilisait
`isMax = s.lv >= stars` : un sub se dorait quand son LV total atteignait le nombre d'**étoiles** — donc à 5
ticks pour un 5★, etc. Faux : le cap par-sub est de **6 ticks totaux (base + reforges), fixe quel que soit
le rang**, pas le rang lui-même → `isMax = s.lv >= 6`. (`s.lv` = la somme entre parenthèses `(N base + X
reforge)`.) Le socle d'un 6★ étant 4/4/3/3, un sub n'atteint 6 qu'après reforges, jamais au socle. `stars`
n'est plus nécessaire (prop retirée de `SubstatRow`). Purement cosmétique. Typecheck + build verts.

### Session 2026-06-28 — 🟡 Onboarding : Setup pane → wizard linéaire brand-aware

Le Setup pane (auto-ouvert au 1er lancement) était une **checklist plate** de 4 checks (emulator
installed/running · ADB · root) — du jargon technique balancé d'un coup. Transformé en **wizard guidé**
qui ne montre que le **blocage courant**, avec instructions **par marque** d'émulateur.

- **Stepper** ([`SettingsModal.tsx`](../apps/renderer/src/design/SettingsModal.tsx) `SetupPane`) : barre de
  progression `N/4`, étapes franchies repliées (✓), étape courante en carte cyan « step N of 4 » + fix +
  détail live, étapes à venir grisées. **Re-check** (footer) fait avancer le wizard.
- **Brand-aware** (`BRAND_FIX`) : les étapes ADB / root affichent le **chemin de menu exact** selon
  `result.emulator.type` (LDPlayer / MuMu / Nox) au lieu d'un texte générique.
- **Cas « pas d'émulateur »** : l'étape install liste les 3 émulateurs supportés (LDPlayer recommandé) +
  note honnête « root requis, Google Play Games KO, mobile/autre émulateur pas encore supporté — roadmap »
  (le mobile reste l'item séparé « Support Mobile et émulateur »).
- **Étape finale** (`ReadyCard`, quand `ready`) : les **vraies next-steps** de capture (Arm capture →
  ouvrir Outerplane → lobby → Disarm pour codex/geas), au lieu de simplement « tout est vert ».
- **Accès fiable** : le bouton **Setup** (header, seul point d'entrée) ouvre désormais **toujours** sur
  l'onglet Setup (= le wizard), pas le dernier onglet. Pas de toggle dédié : l'auto-ouverture au lancement
  reste pilotée par `gs.onboarding.done` (réarmable via Settings → Data → « Reset onboarding prompt »).
  Build + 237 tests verts.

### Session 2026-06-28 — 🟡 Garde-fou cartésien estimé AVANT le clic SOLVE

Le bandeau « ~X combinaisons » n'apparaissait qu'**après** le clic (les `poolSizes` venaient du
precompute au démarrage du solve) : on cliquait, on attendait, *puis* on apprenait que ce serait lent.
Désormais il s'affiche **avant**, et se met à jour à mesure qu'on règle les filtres.

- **Mécanisme** ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) : un
  `precomputeContext` **debounced (250 ms)** tourne sur le main thread quand le héros/filtres/mode
  changent **à l'idle** → `estimatePools`. `cartesianEstimate` lit le **live** `poolSizes` pendant un
  solve, l'**estimation** sinon. Réutilise exactement le precompute de l'orchestrator (mêmes pools).
- **Mode-aware** : le prune diffère (Score+sans-priorité = cartésien complet, CP = budget borné), donc
  l'estimation prépare les pools pour le **mode du bouton SOLVE qui va partir**. Le `solveMode` du split
  button a été **remonté** dans le corps du Builder (threadé `BuilderToolbar` → `SolveButton`).
- Helper `buildSolveFilters` extrait (reducer `SolverFilters` → engine `SolveFilters`), partagé solve +
  estimation. Estimation droppée hors-héros / pendant un solve. Build + 237 tests verts.

### Session 2026-06-28 — 🟢 Exclusion globale de pièces (Inventory → solver)

Clic-droit sur une pièce (Inventory) → **« exclure du solve »** (typiquement des rolls éclatés) → tous
les solves la sautent. Distinct du multi-select « Exclude equipped » (qui exclut le gear d'un *héros*) :
ici c'est une propriété de la **pièce**, account-wide.

- **Storage** ([`lib/storage/excludedPieces.ts`](../apps/renderer/src/lib/storage/excludedPieces.ts),
  `gs.solver.excludedPieces`, **durable** — « cette pièce est nulle » survit à la session), possédé par App.
- **Engine** : `excludedPieceUids` threadé comme `heroPriority` (SolveArgs → SolveRequest → worker) ;
  `allow()` rejette `excludedPieces.has(g.uid)` **en premier**, donc la pièce n'entre dans **aucun** pool
  (couche dure, phase 2 — compose proprement avec l'auto-prune mou phase 3).
- **UI Inventory** : **clic-droit** sur une tile (raccourci power-user) **+** bouton « Exclude from solver »
  dans le panneau de détail (surface découvrable). Tile exclue = liseré rose + icône dimmée + badge ⊘.
  Handler `toggleExclude` stable (`useCallback`, App) → le memo des `GearTile` reste effectif.
  `App.tsx` (state + wiring Inventory↔Builder), `InventoryScreen.tsx`, engine `types`/`orchestrator`/`engine`.
  Build + 237 tests verts.

### Session 2026-06-28 — 🟡 Persistance des filtres par héros (Builder, session-scoped)

Changer de héros **résettait** les filtres (« j'avais mis quoi comme réglage ? »). Désormais les filtres
sont **mémorisés par héros** : on snapshot ceux du héros sortant et on restaure ceux de l'entrant.

- **Storage** ([`lib/storage/heroFilters.ts`](../apps/renderer/src/lib/storage/heroFilters.js),
  `gs.solver.heroFilters`, **sessionStorage** — reset au lancement, comme les autres états de vue ;
  distinct des **Filter presets** nommés/durables). Seul `excludedHeroes` (Set) est converti.
- **Mécanisme** (`BuilderScreen`) : `filtersRef` (miroir live, évite de re-déclencher l'effet à chaque
  édition), `prevHeroRef` (héros chargé), `heroFiltersRef` (map). Sur changement de héros : save sortant
  (`cloneFilters`) → `dispatch(loadPreset)` du snapshot entrant **ou** `resetAll` si aucun. **Les résultats**
  restent vidés (per-hero, stale autrement). Build + 237 tests verts.

### Session 2026-06-28 — 🔴 Fix mirroring : chance de contre affichée brute (« 187 » → « 18.7% »)

Le passif accessoire **Punishment** affichait « Has a **187** chance to Counterattack » au lieu de
**18.7%** (15/18.7/22.5/26.2/30% selon le tier). Vérifié en jeu : le client affiche bien le **%**, donc
c'est un **bug de mirroring chez nous** (et chez outerpedia-v2, qui a la même logique `_is_permille`).

- **Cause** : le buff de contre (`Type = BT_RUN_FIRST_SKILL_ON_TURN_END_DEFENDER`) stocke sa **chance de
  proc en permille** (1000 = 100% → 187 = 18.7%) mais porte `StatType ST_NONE` / `ApplyingType OAT_NONE`,
  donc aucune des règles `isPermille` de [`build.mjs`](../data/build.mjs) ne le captait → valeur brute.
- **Fix** : `isPermille` traite ce `Type` comme permille (tous ses buffs stockent une chance permille ;
  seul Punishment alimente un passif gear via `[Value]`). **Même fix appliqué en amont** dans le
  `_is_permille` d'outerpedia-v2 (on réimplémente la logique en JS depuis les tables brutes → les deux
  copies doivent le porter pour rester synchrones). `npm run data:build` régénère `equipment-passives.json`
  (+ `version.json`). Scan : 0 passif « [N] chance » brut restant.

### Session 2026-06-28 — 🟡 Home : chiffres du dashboard cliquables → Inventory filtré

Les chiffres du dashboard étaient du texte mort. Cliquer sur un facet **draille** désormais vers
l'onglet Inventory **pré-filtré** sur exactement ce sous-ensemble.

- **Cibles** ([`HomeScreen.tsx`](../apps/renderer/src/screens/HomeScreen.tsx)) : les **5 tiers de qualité**
  (« Poor · 150 » → quality=Poor), la répartition **par slot** (« Boots · 12 » → slots=boots), et les
  **top armor sets** (→ armorSets=set). Boutons (hover + tooltip « click to see… »), désactivés à count 0.
- **Mécanisme** : `HomeScreen.onDrill(facet)` → `App` pose un `invDrill` + bascule sur l'onglet Inventory →
  `InventoryScreen` **consomme** le drill (remplace les filtres par le seul facet — donc le grid montre
  exactement le compte cliqué —, reset tab « all », vide la sélection), puis `onDrillConsumed` le nettoie
  (un retour ultérieur ne ré-applique pas un filtre périmé). Type `InventoryDrill` exporté par l'Inventory.
- `App.tsx` (state `invDrill` + wiring Home↔Inventory). Build + 237 tests verts.

### Session 2026-06-28 — 🟡 Défauts solver alignés sur le jeu réel

`INITIAL_FILTERS` ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) — deux défauts
qui trompaient l'utilisateur lambda corrigés :

- **Reforge `disable` → `classic`** : chaque solve note le gear au **+10 endgame** (la norme ; le +15
  coûte des ressources rares), au lieu du gear **capturé** (+0/+9) — un classement sur un état jamais joué.
- **Equipped scope `all` → `lower`** : le solver ne pioche que chez les héros **strictement moins**
  prioritaires (auto-rangés par CP à la capture via `fillUnrankedByOrder`) → ne déshabille **jamais** un
  héros égal/supérieur. Sans ranking, dégrade en own+free (`isLowerPriority` ∞>∞ = false) — sûr partout.
  L'ancien `all` (vol silencieux possible) reste un choix **explicite**.
- **Badge Options recalé** sur la nouvelle baseline (`equippedScope !== "lower"`) → 0 par défaut, se lève
  sur `None`/`All`. Fallback d'affichage du segment → `"lower"`. Engine inchangé (fallbacks API intacts).
- Test de régression #7 ([solver.md](solver.md)) annoté : **Reforge Off** requis pour matcher la card Builds
  (le défaut Classic projette à +10). Tests verts (237 renderer + 22 core).

### Session 2026-06-28 — 🟢 Onglet Worklist (file de changements de gear inter-héros)

Ferme la boucle « optimise N héros → récap de quoi faire ». Nouveau **onglet Worklist**
([`screens/WorklistScreen.tsx`](../apps/renderer/src/screens/WorklistScreen.tsx)) + storage
([`lib/storage/worklist.ts`](../apps/renderer/src/lib/storage/worklist.ts), blob `gs.worklist`, possédé
par App). Bouton **« + Worklist »** dans le Builder (à côté d'Equip build) pousse le **diff par slot**
(slots changés only) du build sélectionné.

- **Cartes par héros**, chaque changement = **ligne cochable** (`fromName → toName`) + bouton
  **Apply locally** (`equipPieces` réécrit le snapshot local ; jamais d'écriture vers le jeu).
- **États dérivés live de l'inventaire** (rien n'est figé) : `applied` (pièce déjà sur le héros → vert),
  `stale` (toUid absent → grisé, exclu de l'apply), `conflict` (`claimCount` > 1 → deux builds réclament
  la même pièce). **Self-healing**.
- **Auto-prune à chaque refresh d'inventaire** (recapture/reload/apply/sync) : `reconcileWorklist` retire
  les changements faits pour de vrai (pièce désormais sur le héros) + les entrées vidées (App `useEffect[inv]`).
- **Libellés player-facing** (`toDesignSlot` : `ooparts`→Talisman, `shoes`→Boots) + **main stat affichée
  sur les lignes talisman** (`toMain`) pour lever l'ambiguïté des noms qui se ressemblent.
- `Shell.tsx` (onglet + `TabCounts.Worklist` = changements restants), `App.tsx` (state possédé + wiring),
  `BuilderScreen.tsx` (prop `onAddToWorklist` + handler + bouton). Build + typecheck verts.

### Session 2026-06-28 — 🟢 Diff avant/après par slot (Builder)

Répond à « qu'est-ce que je change, et ça vaut le coup ? » — la brique réutilisée par la Worklist.

- **StatsPanel** : **Δ numérique signé** par axe (`proj − current`, arrondi) en plus du tint vert/rouge.
- **BottomGearBand** : **liseré cyan** + ligne `← <pièce remplacée>` (ou `+ new slot`) sur chaque slot qui
  **change** vs l'équipé (définition alignée sur `upg` via une Map `currentLoadout` slot→pièce équipée).
- **Header de la band** : **`N slots change`** + **`ΔCP ±X`** (`build.cp − currentCp`, `currentCp` =
  `calcBattlePower` du loadout équipé ajouté à `composition`). Données déjà calculées → surtout du rendu.
  `BuilderScreen.tsx`. Typecheck vert.

### Session 2026-06-28 — Builder : déclencheur « Equip build »

Branchement de l'étape 3 de Equip/Unequip côté **Builder** (le core + endpoint writer + client
`src/equip.ts` étaient déjà livrés). Au-dessus du **bottom gear band** (le build sélectionné), bouton
**« Equip build → \<héros\> »** : applique les 8 pièces du build au héros sélectionné en réécrivant le
snapshot capturé.

- **Atomique** — nouveau `equipPieces(game, uids, charUid)` (client) : fetch du snapshot **1×**, fold de
  `equipItem` sur chaque uid, write **1×** (`POST /api/captured/user-item`). Pas de round-trip par pièce.
- **Plan d'équipement** (`equipPlan`, mémo) : ignore les pièces déjà sur ce héros (`moving`), compte celles
  actuellement sur un autre héros (`steal`, seraient « volées »).
- **Popup de confirmation** (`EquipConfirm`, même style que `RecoBuildPicker`) — au lieu d'un bouton 2-temps
  jaune ambigu : récap « moves N pieces onto \<héros\> », ⚠ ambre si `steal > 0`, **Cancel / Equip**.
  Pendant l'écriture → *Equipping…* (fermeture/Escape/clic-fond bloqués) ; échec/**409 (capture armée)** →
  message rose inline « disarm first » + **Retry**, la popup reste ouverte.
- **Succès** → `App.refreshInventory("Equipped build")` (barre de statut + ré-import ; le band repasse les
  pièces en « sur ce héros », le bouton se désactive). Désactivé quand rien ne bouge.

`equip.ts` (+`equipPieces`), `App.tsx` (prop `onAfterEquip`), `BuilderScreen.tsx` (prop, `equipPlan`,
`equipSelectedBuild`, `EquipBuildButton` + `EquipConfirm`). Typecheck vert (fichiers touchés).

### Session 2026-06-27 — ⚪ `version.json` idempotent (fini le dirty perpétuel) + committé au release

`data/derived/version.json` (`{hash, builtAt}`) était réécrit avec un nouveau `builtAt` à **chaque**
`data:build` / release → toujours dirty, et [`release.mjs`](../scripts/release.mjs) ne stageait que
`apps/desktop/package.json` (step 6) → le stamp de la release n'était **jamais** dans le commit.

- **Écriture idempotente** ([`build.mjs`](../data/build.mjs)) — on ne réécrit version.json **que si
  le hash de contenu change**. Le build étant déterministe, un rebuild sans changement de données
  laisse le fichier byte-identique → working tree propre. `builtAt` devient la **date du dernier vrai
  changement de données** (le millésime), pas l'heure d'horloge du build.
- **Release stage `data/derived`** (step 6) — le snapshot dérivé réellement buildé+publié atterrit
  dans le commit `chore: release vX.Y.Z` (no-op si rien n'a changé grâce à l'idempotence).

### Session 2026-06-27 — 🟠 Projection reforge ascended : passif de singularité manquant + visibilité des ticks

Deux trous sur le preview de mode reforge ([`engine.ts`](../apps/renderer/src/lib/solver/engine.ts) +
[`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) :

- **Passif de singularité absent** — la projection ascended basculait la pièce en `+15 · ascended`
  mais n'ajoutait **jamais** le passif inconditionnel de singularité (le bonus *définissant* de
  l'ascension). `addProjectedSingularity` l'ajoute désormais en mode ascended : DMG+ sur
  arme/accessoire, DMG- sur les 4 armures, à la **meilleure valeur** de `singularity-options.json`
  (DMG+ 50 %, DMG- 25 %). Route via `fromBuff` → compte dans **score + CP + carte**, pas juste
  l'affichage. Une pièce **déjà ascended** conserve son **vrai roll** (jamais écrasé par le plafond).
  +5 tests (slots DMG+/DMG-, classic = pas de passif, non-écrasement d'un vrai roll, Talisman/EE
  intouchés).
- **Visibilité des ticks de reforge** — sur une carte projetée, impossible de voir *quel* sub avait
  proc ni de *combien*. Le `BottomGearBand` calcule le **delta de ticks** (projeté − capturé, aligné
  1:1 car `simulateReforges` clone les subs dans l'ordre) → badge cyan `+N` par sub reforgé.

### Session 2026-06-27 — 🟡 UX Builder : état d'équipement sur les cartes, reset au changement de héros, save build+preset fusionnés

Trois nits UX sur le Builder ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) :

- **État d'équipement sur les gear cards de résultat** — chaque carte du `BottomGearBand` affiche
  désormais un badge : 🟠 `[portrait] <nom>` quand la pièce est **équipée sur un autre héros**
  (appliquer le build la lui retirerait), 🟢 `equipped` si déjà sur le héros courant, `free` sinon.
  Résolu via une map `charsByUid` + `selfUid`, sur l'`equippedBy` de la pièce **originale** (pas le
  clone reforge). Le portrait à 14px (< `PORTRAIT_OVERLAY_MIN`) = face icon nue, propre.
- **Reset au changement de héros** — un effet sur `selectedUid` annule le solve en cours, remet les
  **filtres** à `INITIAL_FILTERS` (`resetAll`) et vide **tous les résultats** (table, sélection,
  displayFilter, reforge, progress, debug, mode). `useRef` skippe le mount initial. L'annulation
  empêche un `onResult` asynchrone de repeupler la table pour le mauvais héros.
- **Save build + filter preset fusionnés** — « Save build » persiste désormais **les deux** (SavedBuild
  + FilterPreset, même nom + `createdAt`) en une confirmation ; bouton + handler `saveCurrentPreset`
  séparés supprimés. Le panneau « Filter presets » reste pour charger/supprimer.

### Session 2026-06-27 — 🟡 unification des clés de stats (registre source-de-vérité)

**Le problème** : le même concept portait 2 noms selon la couche — ENGINE (`critRate`/`critDmg`/
`effRes`/`dmgReduce`/`critDmgReduce`, sur les rolls/gems/tokens/`ROLL_NORMS`) vs USER (`crc`/`chd`/
`res`/`dmgRed`/`critDmgRed`, sur `FinalStats`/`priority`/`STAT_NORMS`), pontés ad-hoc par
`STAT_TO_PRIORITY`. Rien ne **garantissait** que le pont couvrait toutes les clés → bug-surface
silencieux (une stat ajoutée pouvait no-op sans bruit).

**Le fix** — unification sur les noms ENGINE (le plus large) + **registre unique**
[`apps/renderer/src/lib/statRegistry.ts`](../apps/renderer/src/lib/statRegistry.ts) (`STAT_AXES`,
typé contre `StatType` de core) **d'où dérivent** `ROLL_NORMS`/`STAT_NORMS`/`STAT_TO_PRIORITY`/
`FINAL_STAT_KEYS` — plus de littéraux dupliqués (`ratings.ts` ré-exporte les dérivés). Les champs
`FinalStats` renommés (`crc→critRate`, `chd→critDmg`, `res→effRes`, `dmgRed→dmgReduce`,
`critDmgRed→critDmgReduce`) → le compilateur a guidé tous les lecteurs typés (cp, ratings, dmgValue,
buildAdvice, engine, Builds/Builder). `STAT_TO_PRIORITY` se réduit au seul repli flat/%→axe
(`atkPct→atk`…). La dualité `atk`/`atkPct` (flat vs %) **reste** (deux variants d'un axe). La
fusion `atk`/`atkPct` collapse toujours en `atk`.

**Hors périmètre (volontaire)** : le namespace **baseline** (`chc`/`dmgInc`) + `ScalingMap`
(`res`/`eff`) + la clé **data** `dmgSec.stat: "crc"` (dans `characters.json`, générée) restent —
mappés au bord (ex. `crc → s.critRate` dans `computeCheapRatings`), pour ne pas régénérer `data/derived`.

**Persistance migrée** (idempotent) : `filterPresets.fromSerialized` (priority + statFilters) et
`savedBuilds.loadSavedBuilds` (build.finalStats + reforge.priority) réécrivent les anciennes clés via
`renameLegacyStatKeys` → presets/builds sauvés avant l'unif continuent de marcher.

**Tests** : +`statRegistry.test.ts` (11 — FinalStats ↔ axes, couverture du pont, tokens, **snapshot
numérique** ROLL_NORMS/STAT_NORMS = parité, migration legacy). Suites existantes mises à jour.
219 → **232** (renderer) ; core 22 ; **254** total. Typecheck + CP 0-diff verts (renames purs).

### Session 2026-06-27 — 🟠 budget combos unifié (Score AVEC priorité n'était PAS borné) + instrumentation

**Le bug** (diagnostiqué via le nouveau « Copy Debug Info », cf. ci-dessous) : un solve **SOLVE (Score)
avec priorité** sur un vrai compte = **703 836 000 combos / 142 s**. Le budget-combos absolu n'existait
que pour le **mode CP sans priorité** ; toutes les autres branches passaient par `topPctPrunePreserving`,
un prune **en pourcentage par slot** qui **ne borne pas le PRODUIT** (30 % de sept pools ~40-50 = encore
~7e8 combos). Le ⏱ ne le montrait pas non plus (il démarrait au fan-out, masquant le precompute).

**Le fix** — `precomputeContext` ([engine.ts](../apps/renderer/src/lib/solver/engine.ts)) : le prune Top% est
**unifié sur `allocateComboBudget`** (`∏ keep ≤ COMBO_BUDGET × topPct/30`) pour **toutes** les branches ;
seul le **classement par slot** diffère :
- **priorité explicite** (Score ou CP) → `priorityScoreOf` (score par-roll pondéré, combat-only exclus) ;
- **CP sans priorité** → proxy CP (`cpEval` sur le build courant) + pin de la pièce équipée (inchangé) ;
- **Score sans priorité** → `magnitudeScoreOf` (magnitude brute des rolls) — pas d'objectif mais le produit
  doit rester borné (sinon cartésien complet).

`topPctPrune` / `topPctPrunePreserving` supprimés (morts) ; `CP_COMBO_BUDGET` → `COMBO_BUDGET` (général).
La protection des sets requis + le pin passent par `keepTopN` pour les trois objectifs identiquement.
**Effet attendu** : Score+priorité 142 s → ~1-2 s (budget 8 M @ Top% 30). +4 tests `cpPrune.test.ts`
(`priorityScoreOf`/`magnitudeScoreOf` : pondération, exclusion combat-only, magnitude). 237 → **241**.

**Instrumentation** (commit précédent, même session) : ⏱ honnête (démarre à l'entrée de `solve()`, inclut
le precompute) + bouton **« Copy Debug Info »** dans le footer Builder (visible si `gs.debug.solver`),
qui copie un snapshot JSON par solve : `precomputeMs` vs `searchMs`, mode, topPct, `hasPriority`,
`equippedScope`, tailles de pools, P/S, détail par worker, et (CP) top-CP vs CP équipé (`debugCurCp`).

### Session 2026-06-27 — Builds advice : lot restant (1)/(2) + tolérance crit cap

Trois affinages de `computeAdvice` (`lib/buildAdvice.ts`, module pur testé standalone) :

- **(1) Bruit Missing supprimé sur persos WIP** — `Missing: …` ne sort plus que quand le héros est
  **quasi-complet** (`≤ MISSING_ADVICE_MAX = 2` slots vides). Au-delà (banc / work-in-progress) la ligne
  reste silencieuse — lister 4-5 slots vides est du bruit, pas un conseil actionnable. Le reste des règles
  reste différé dès qu'une pièce manque (layout d'armure non figé).
- **(2) Pièces sous le cap d'enhance** — nouvelle ligne agrégée `N pieces below max enhance` (tone `info`),
  dans la boucle existante de la règle 6 (upgrade headroom). Cap = **+10** normal, **+15** une fois ascended
  (miroir du contrat `GearPiece.enhanceLevel` 0..10/10..15). Gear principal seulement (gemmes exemptées).
- **Tolérance crit cap (règle 4)** — le crit chance ne warn plus qu'au-delà de **102 %** (marge anti
  crit-resist : on overcap volontairement 1-2 pts, donc 100-102 % n'est pas gaspillé). PEN reste à 100 %.
  `capWaste` prend désormais le cap en paramètre ; le message reflète le seuil réel (`… over the 102% cap`).

`buildAdvice.test.ts` 11 → **16 tests** (missing quasi-complet vs WIP silencieux, under-enhance agrégé +
non-flag d'une pièce max, crit toléré à 101 / warn à 103.5). **Reste — (3) lot secondaire** (off-scaling
main vs `meta.dmgStat`, basse qualité, « 4pc dispo en inventaire ») : différé, nécessite de threader
`inventory.gear` + `meta.dmgStat` dans `AdviceInput`.

### Session 2026-06-27 — Home : vues Gear breakdown (Class / All sets / Talisman) + toggle

La carte **Gear breakdown** (Home) gagne un **toggle** segmenté 4 vues (`gearView`) : **Overview** (inchangé :
par slot + top 5 sets), **Class**, **All sets**, **Talisman**. Les compteurs d'état (Ascended / +15 / Locked)
restent épinglés en bas dans chaque vue. Tout est dérivé de `inventory` + `game` dans `computeStats` (aucun fetch).

- **Class** — par classe (Striker/Ranger/Mage/Defender/Healer), deux colonnes **arme / accessoire** (en-têtes =
  icônes d'onglet inventaire `SLOT_BY`), chaque cellule liste en chips les **effets de passif uniques**
  (icône `effectIcon`, badge de count si >1, hover = nom + description). **Catalogue complet** des effets *à
  restriction de classe* (séédé depuis `equipment.json`, count 0 superposé par l'inventaire) → un effet non
  possédé apparaît grisé, **count 0 en rouge**. Tri : possédés d'abord. Unicité par **nom de passif** (pas
  l'icône, réutilisée entre effets distincts).
- **All sets** — grille de **tous les sets d'armure existants** (21, depuis `equipment.json`, pas seulement le
  possédé), chips icône + count, triés par possédé d'abord, non possédés grisés / 0 rouge. Unicité par **nom de set**.
- **Talisman** — table croisée **type de talisman (lignes) × main-stat (colonnes)**. Lignes = catalogue des
  15 talismans (art de l'item `image` encadré du fond de rareté `TI_Slot_Unique` comme l'inventaire, hover =
  nom + nom de l'effet via `multiTierPassives`), colonnes = les **9 main-stats** ooparts (`atkPct/hpPct/defPct/
  critRate/critDmg/dmgUp/dmgReduce/eff/effRes`, en-têtes = icônes `STAT`). Cellules = count possédé (heatmap
  cyan, `·` si 0) + colonne `Σ` + ligne `Total` ; main-stat lue depuis `p.main`.

`HomeScreen.tsx` only (helpers `Segmented`, `EffectChipView`/`ChipWrap`, `ClassEffectRow`/`SlotHead`,
`OopartsTable`). Typecheck vert (HomeScreen).

### Session 2026-06-27 — 🔴 principe de priorité des héros (scope d'items « ≤ inférieure »)

Nouveau modèle de **priorité par héros** : un **entier unique** par perso (`HeroPriority` = `charUid → int`,
`gs.priority.rank`), **rank 1 = priorité la plus haute** (nombre plus petit = plus important), `null` par défaut
= non-classé = priorité la plus basse. Store pur `lib/storage/heroPriority.ts` : `setHeroRank` garantit
l'**unicité** (poser un rank déjà pris **échange** les deux héros), `rankOrder` (rank, +∞ si non-classé) /
`isLowerPriority` (strict ; deux non-classés ne se volent pas). +11 tests `heroPriority.test.ts`.

**Solveur** : le toggle binaire `includeEquippedOnOthers` devient un **scope 3-états** `equippedScope` (`none`
= héros seul + libre · `lower` = **+ héros strictement moins prioritaires** (jamais un égal/supérieur) · `all`
= tout, défaut legacy). `allow()` (`engine.ts`) et `buildGemPool` (`gems.ts`) lisent le scope + `heroPriority`
(porté dans `SolveRequest`). Presets migrés (`includeEquippedOnOthers` true/absent → `all`, false → `none`).
+1 test gem-pool « lower ».

**UI** : `App` possède `heroPriority` (persisté) et le passe à **Builds** (édition) + **Builder** (solve, live
car le Builder reste monté). **Builds** : colonne **Rank** à gauche du portrait — poignée de **drag-to-reorder**
(`⠿`, visible en tri `# Rank`) + champ éditable. Modèle **positionnel contigu 1..N** (`reorderRank` /
`moveRankBefore`) : taper N ou déposer une row place le héros en position N, tout se renumérote ; vider = non-classé.
Toggle **# Rank** dans la barre de filtres pour trier par priorité (rang 1 d'abord). **Normalisation hybride**
(`fillUnrankedByOrder`) : les rangs **manuels sont préservés** (compactés, sans trou) et les héros **non-classés
reçoivent un défaut par CP**, ajoutés à la suite (renumérotation contiguë 1..N). No-op si tout est déjà classé →
ne se déclenche qu'à la 1re utilisation ou après une nouvelle capture, sans jamais écraser un classement géré.
Marqueur d'insertion **cyan en haut de la row** survolée pendant un drag.
**Builder → Options** : contrôle segmenté **Equipped items** Aucun / ≤ Lower / Tous. Suite : 232 tests verts.

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
