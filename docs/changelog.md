# Changelog — livraisons gear-solver

> **Journal de ce qui a été livré** (le « suivi »). Les tâches **ouvertes** vivent dans
> [todo.md](todo.md) ; le détail commit-par-commit est dans l'historique git, et les jalons
> dans [roadmap.md](roadmap.md).

---

## Items de backlog clôturés (index)

### 🗜️ Builder : mode compact des cartes de résultat resserré, sans icône de pièce, gemmes en icônes, stats sur deux colonnes, actions rapides (G79) (2026-10-31)
- ✅ **Pourquoi.** Demande de Sevih du 31/10 : la carte compacte (Settings › Solver › « Compact result cards ») restait
  trop haute pour comparer les huit cartes d'un coup. Tout se joue sur le chemin `compact === true` de
  `ResultItemDetail` / `ResultGearDetailBody` (`apps/renderer/src/design/ResultGearDetail.tsx`).
- ✅ **En-tête sans icône.** `EquipmentIcon` disparaît de la carte compacte ; à droite du nom (couleur de rareté ou
  dégradé Singularity inchangés, cadenas et portrait du porteur conservés), en mono 11 px : `+N` (enhance, toujours,
  `+0` compris), `T<n>` si breakthrough, `N★`. Le ou les mains passent sur une ligne pleine largeur (icône + valeur,
  deux mains côte à côte, une moitié chacune). L'EE n'a plus de ligne d'icône du tout (pas de main).
- ✅ **Substats 2 × 2.** `CompactSubCell` : icône 16 px + valeur, grille `grid-cols-2` dans l'ordre de `piece.subs`
  (ligne par ligne). Plus de badge LV, de `+n` ni de `T+n` à l'écran : tout passe dans le `title` par
  `compactSubTitle(s, added, transistone)` (« LV 5 (4 + 1) · Attack% · T+1 »). La teinte de la valeur garde l'indice
  (`compactSubTone`) : cyan si des ticks projetés y entrent, violet si c'est la Transistone, cyan prime si les deux.
  Choix fait sur un point que l'énoncé laissait ouvert : une ligne au cap de 6 ticks reste ambre SAUF si des ticks
  projetés ou Transistone y entrent (le projeté prime, c'est lui qu'on veut voir d'un coup d'œil). La branche
  compacte de `SubstatRow` est retirée, sa branche non compacte n'a pas changé.
- ✅ **Gemmes.** `CompactGemRow` : une ligne de cinq icônes 20 px (`/img/items/TI_GEM_<type>_<level>.webp`), socket
  vide en carré pointillé, verrouillé avec le cadenas SVG, `title` « Lv n · <stat> <valeur> » / « Empty gem slot » /
  « Locked — unlocks at enhance +5 ». `GemPanel` n'est pas touché (le SVG du cadenas est recopié plutôt que factorisé
  pour laisser le chemin non compact intact).
- ✅ **Effets Singularity.** `compactEffect(e)` (pure, exportée) : stat + valeur → `{ kind: "stat" }` (icône 14 px +
  valeur signée, `title` libellé long + valeur), `desc` → `{ kind: "text" }` (`e.name`, sinon les 24 premiers
  caractères sans balises + « … », `desc` complète sans balises en `title`). Tous les effets de la pièce sur UNE ligne
  (`whitespace-nowrap`, le texte tronqué). La passive multi-paliers du talisman ne change pas.
- ✅ **Qualité.** `14/20` dans la couleur du palier, `→17` en violet si `reachable`, puis le palier abrégé ; `title` =
  libellé complet + `QUALITY_HELP` (+ `QUALITY_REACHABLE_HELP` si `reachable`). `qualityShortLabel(tier)` exportée par
  `apps/renderer/src/lib/quality.ts` (Poor, Dec., Good, Exc., Perf.).
- ✅ **Actions rapides.** `CardActions({ actions })` (exporté, liste `{ key, icon, label, active?, onClick }`) : rangée
  d'icônes 24 px alignée à droite, chaque bouton dans une `RichTooltip` (le libellé au survol) avec `aria-label` et
  `aria-pressed`. Une seule action : exclure / inclure (icône ⊘ en SVG, teinte rose quand la pièce est exclue),
  « Exclude from solver » / « Excluded from solver — click to include ». Le bouton pleine largeur reste en non
  compact. Aucune autre action, aucune requête au jeu.
- ✅ **Largeur.** Tout tient en `w-56` (224 px, 192 px utiles) : la carte compacte passe de `w-64` à `w-56` et le seuil
  de la grille 4 colonnes de `apps/renderer/src/screens/builder/BottomGearBand.tsx` de 1360 à 1232 px
  (4 × 224 + 3 × 8 + 288 + 8 + 16), commentaire compris. Un nom de set long passe sur deux lignes, comme avant.
- ✅ **Chemin non compact.** Comparé par rendu : l'ancien `ResultGearDetail.tsx` (copie du commit parent) et le nouveau
  rendus par `renderToStaticMarkup` côte à côte, `compact` absent puis `false`, sur arme Singularity verrouillée à
  deux mains, effets stat et `desc`, passive multi-paliers, qualité avec et sans `reachable`, talisman et EE à gemmes
  (pleine, vide, verrouillée), pièce nulle, exclu ou non, avec et sans `onToggleExclude` : markup identique sur les
  40 combinaisons (fichier de banc temporaire, supprimé). Les seules retouches de code sur ces branches sont des
  ternaires `compact` devenus morts (le `title` de la qualité, la branche compacte des mains et des effets).
  `design/GearDetail.tsx` (Inventaire) n'est pas touché.
- ✅ **Docs.** Description du réglage dans `design/settings/SolverPane.tsx` ; `wiki/Using-the-App.md` (Builder) ;
  `docs/solver.md` / `wiki/Solver.md` (BottomGearBand, mode compact, seuil 1232 px).
- ✅ **Tests.** `apps/renderer/test/compactCard.test.ts` (12 tests) : `qualityShortLabel` (cinq paliers),
  `compactEffect` (stat positive et négative, `desc` avec nom, tronquée à 24 + « … », courte, balises ôtées),
  `compactSubTitle` / `compactSubTone`, puis un rendu serveur de `ResultItemDetail` (`EquipmentIcon` mocké en
  marqueur) : en compact pas d'`EquipmentIcon`, en-tête `+15T26★` (et `+0` sans breakthrough), quatre cellules de
  substat dont le texte visible n'est que la valeur (ni « LV » ni `T+`) et le `title` porte « LV 5 (4 + 0 + 1) ·
  Attack% · T+1 », gemmes sans texte visible et `title` par socket, qualité `14/17→15Good`, effets sur une ligne, UN
  bouton d'action avec `aria-label` « Exclude from solver » (« Excluded from solver — click to include » et
  `aria-pressed="true"` une fois exclue) ; en non compact l'icône et le bouton pleine largeur « Exclude from solver »
  sont là. `compactName.test.ts` passe inchangé. `npm run typecheck` : sortie vide (0 erreur) ; `npm test` :
  « Tests 872 passed (872) » (renderer), 237 et 169 dans les autres workspaces ; `npm run lint` : « ✖ 13 problems
  (0 errors, 13 warnings) », le même compte qu'avant le lot.
- ⏳ **Sevih sur le fixe** : Settings › Solver › Compact result cards → cartes plus étroites, sans icône de pièce
  (`+15 T2 6★` à côté du nom), subs deux par ligne avec le détail au survol, gemmes en icônes, qualité et effets sur
  une ligne, petite icône ⊘ en pied (infobulle, teinte rose une fois exclue) ; grille 4 × 2 dès 1232 px de fenêtre.
  Couper le réglage : les cartes reviennent à l'identique.

### 💎 Builder : les gemmes servent les bornes minimales des filtres de stats avant la priorité, repli sur les gemmes serties (G78) (2026-10-30)
- ✅ **Pourquoi.** Bug vu par Sevih le 30/10 : un filtre ATK ≥ 12 000 et une priorité (ATK 3, CHD 3, SPD 2, CHC 2…)
  ne rendaient AUCUN résultat, les mêmes filtres sans priorité en rendaient. L'allocation de gemmes du solveur
  (`gemAllocByTalismanSlots` / `gemDeltaByTalismanSlots`, puis le chemin cap-aware) remplace les gemmes serties par
  un choix fait sur la seule priorité : les gemmes ATK du héros sautaient, l'ATK retombait sous la borne et
  `passesSpecs` écartait toutes les combinaisons. Seules les bornes `max` étaient vues (`noFill`). Un filtre est une
  contrainte dure, une priorité un ordre de préférence : les gemmes servent désormais les `min` d'abord.
- ✅ **Allocateur.** `apps/renderer/src/lib/solver/gems.ts` : `allocateGemsServingMins(scored, talismanSlots, eeSlots,
  mins, preGemCrc, reachCap = false)` (+ type `GemMinNeed { stat, shortfall, gainOf }`). Pour chaque borne manquée,
  dans l'ordre donné, pose les gemmes dont la stat tombe sur l'axe (`STAT_TO_PRIORITY` : `atkPct` et `atk` servent
  `atk`), tout le pool même de score 0 ou négatif, plus gros `gainOf` d'abord, jusqu'à couvrir le manque ; une borne
  incouvrable reçoit tout ce qu'il y a. Le reste suit la règle courante : atteindre le cap de CHC d'abord si `reachCap`
  (comme `allocateGemsReachingCap`), puis `pickOrder` en sautant les gemmes crit au-delà du cap (comme
  `allocateGemsCapped`). Talisman puis EE, aucune gemme posée deux fois (`Set` des instances). Le 6ᵉ paramètre
  `reachCap`, absent de l'énoncé, porte `wantCritCap` : l'allocateur ne peut pas le déduire du pool seul.
- ✅ **Gain d'une gemme.** `apps/renderer/src/lib/composeBuild.ts` : `rollGainOnSheet(scaling, axis, value, percent)`
  = `composeMultStat` avec la gemme seule moins sans elle sur ATK / DEF / HP / EFF / RES (base × valeur / 100 ×
  l'amplificateur de buff pour un %, le plat × l'amplificateur pour un plat — le calcul de la pièce, réutilisé et
  non dupliqué), la valeur elle-même sur les axes additifs. Estimation : les taux de buff portés par la gear ne sont
  pas comptés, le retest tranche.
- ✅ **Moteur.** `apps/renderer/src/lib/solver/engine.ts`, boucle Talisman de `solveChunk` : le delta réellement
  appliqué est suivi (`appliedDelta`, défaut ou cap-aware). Quand `passesSpecs` échoue, qu'une borne `min` est posée
  (`hasMinSpec`) et qu'un delta a été appliqué, `serveMinFilters` : manques par stat (`min − fs[key]`, arrondis vers le
  haut à 10 sur ATK / DEF / HP, 0,1 sur les stats en %, 1 ailleurs : l'allocation couvre un peu plus, jamais moins),
  ordre du plus grand en proportion de sa borne, `allocateGemsServingMins`, recompose si l'allocation diffère
  (`gemDeltaEquals`), retest ; sinon retest avec les gemmes SERTIES (compose sans `gemOverride`), gardé alors avec
  l'allocation vide `{ talisman: [], ee: [] }` (« garde les gemmes de la pièce », affichée comme aujourd'hui sans
  priorité), écarté sinon. Une combinaison qui n'échoue que sur une borne `max` est écartée comme avant. SOLVE CP sans
  priorité garde son allocation par CP et n'a que le repli sur les serties. Mémo en trie de clés entières (`MinsMemo`)
  : racine `talismanSlots × 1 000 000 + preGemCrc` (la clé de `capAllocCache`), puis un niveau par borne manquée,
  `indice de spec × 2^21 + manque arrondi` — une allocation par valeur distincte, pas par combinaison, et aucune
  chaîne construite dans la boucle.
- ✅ **Coût.** Banc temporaire (non commité) : `solveChunk` sur 823 543 combinaisons (7 pièces par emplacement),
  priorité CHD, pool 6 CHD + 6 ATK %, médiane de 5 passes. Sans filtre : 345 ms avant, 340 ms après ; filtre
  `atk ≥ 1500` tenu du premier coup : 343 ms avant, 336 ms après (aucune régression : rien n'est calculé avant
  l'échec de `passesSpecs`) ; filtre `atk ≥ 3000` tenable seulement avec les gemmes ATK : 258 ms et **0 résultat**
  avant, 713 ms et 100 résultats après (le chemin lent recompose au plus deux fois une combinaison qui était
  jetée).
- ✅ **Docs.** `docs/solver.md` § 5 et son miroir `wiki/Solver.md` (paragraphe « Bornes minimales des filtres de
  stats ») ; `wiki/Using-the-App.md` › Stat filters (« a stat filter's minimum is served before the priority; a build
  that only passes with its socketed gems keeps them »). `docs/todo.md` : aucun item ne s'y rapportait.
- ✅ **Tests.** `apps/renderer/test/gemsCapped.test.ts`, `allocateGemsServingMins` : une stat sous sa borne prend ses
  gemmes jusqu'au manque puis la priorité ; une gemme de score négatif servie quand même ; deux bornes dans l'ordre
  donné (et l'ordre inverse) ; manque incouvrable → toutes les gemmes de la stat puis la priorité, Talisman puis EE ;
  cap de CHC atteint ensuite avec `reachCap`, jamais dépassé sans ; aucune gemme posée deux fois.
  `apps/renderer/test/solver.test.ts`, `solveChunk` de bout en bout (Talisman aux cinq gemmes ATK % serties, priorité
  CHD) : sans filtre, l'allocation par priorité comme avant ; `atk ≥ 1400` → deux résultats, celui qui manquait la
  borne porte quatre gemmes ATK + une CHD (ATK 1440), l'autre garde l'allocation par priorité ; SOLVE CP sans priorité
  → repli sur les serties, allocation vide, ATK 1500 ; borne intenable avec l'allocation et avec les serties → aucun
  résultat. Les deux premiers tests de bout en bout échouent sur le moteur d'avant (vérifié). `npm run typecheck` :
  `tsc --noEmit` sans erreur dans les trois workspaces ; `npm test` : dernière ligne `Tests  860 passed (860)`
  (renderer ; les deux autres workspaces : 169 et 237) ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, les 13
  avertissements d'avant, aucun dans les fichiers touchés.
- ⏳ **À Sevih.** Rejouer le cas réel (filtre ATK ≥ 12 000, priorité ATK 3 / CHD 3 / SPD 2 / CHC 2) : des résultats
  doivent sortir, leur bande du bas montrant les gemmes ATK (ou celles de la pièce quand les serties suffisent), et
  juger le temps du solve quand une grosse part des combinaisons passe par le chemin lent. Hors périmètre, non
  touché : la pondération de la priorité, les fillers (`gemDmgGains`), l'écran des résultats, la Worklist ; une
  borne `max` manquée à cause des gemmes de priorité n'a pas de repli sur les serties (le lot ne visait que les
  `min`).

### 🪙 Inventaire : carte « Scrap value » sous le panneau de la pièce, icônes, et sélection de pièces (G77) (2026-10-30)
- ✅ **Pourquoi.** Retour de Sevih du 30/10 sur G74 : la ligne de texte sous la barre de tri ne suffisait pas. La valeur
  de rebut devient une carte dans la colonne de gauche, sous le panneau de la pièce, avec l'icône de l'or et celles des
  matériaux ; et le joueur choisit les pièces qu'il compte vendre ou désassembler, la carte chiffrant la sélection
  quand il y en a une, la vue filtrée sinon. Information seulement : aucune action sur le jeu.
- ✅ **Modèle.** `apps/renderer/src/lib/inventory/scrapCard.ts` (pur) : `scrapScope(selection, filtered, byId)` rend
  `{ pieces, label }`, la sélection quand elle n'est pas vide (toutes les pièces sélectionnées, résolues par
  `uiById`, même hors de la vue ; un id disparu n'est pas compté), « 2 selected », sinon `filtered`, « 37 shown » ; le
  troisième argument, absent de l'énoncé, est la table id → pièce sans laquelle une pièce hors vue ne se retrouve pas.
  `materialRows(v, items)` : `{ id, name, icon, min, max }`, nom et icône depuis `items`, inconnu → le nom de
  `scrapValue` (`item <id>`) et `icon: null`. `toggleSelection`, `addAll`, `pruneSelection` rendent un `Set` neuf (le
  même quand rien ne change, pour ne pas déclencher de rendu), sans muter l'entrée.
- ✅ **Carte.** `apps/renderer/src/screens/inventory/ScrapCard.tsx`, sous `ItemDetail` : la colonne gauche devient
  `flex w-80 flex-col gap-3`, `ItemDetail` dans un `flex min-h-0 flex-1` qui lui garde toute la hauteur restante (le
  composant n'est pas touché). En-tête « Scrap value » + la portée ; ligne Sell (icône `CM_Goods_Gold`, montant,
  « 31 sellable ») ; ligne Dissolve (icône or et fourchette s'il y a de l'or, puis les matériaux en tuiles de 32 px,
  icône 24 px `/img/items/<icon>.webp`, quantité en badge, nom en `title`, icône absente → carré neutre aux deux
  premières lettres ; six au plus puis « +n more » avec le reste en `title`) ; dessous en petit « 37 dissolvable »,
  « 3 enhanced: refund not counted », « n not in the game data ». Bordure `border-white/6`, fond `bg-white/[0.012]`.
  Visible quand `hasScrapFields(game.equipment)` ET (filtre posé OU sélection non vide OU mode sélection actif) : ce
  troisième cas, ajouté, évite qu'un « Clear » sans filtre fasse disparaître la carte en laissant le mode allumé et
  invisible.
- ✅ **Sélection.** `InventoryScreen.tsx` : `selection: Set<string>` et `selectMode` en `useState` (jamais persistés).
  Contrôles de la carte : « Select pieces » / « Selecting… » (bascule le mode, ambre quand actif), « Select all shown »
  (`addAll` de `filtered`), « Select excluded » (les `excludedPieces` encore dans l'inventaire), « Clear » (désactivé
  sans sélection), le compte. En mode, un clic sur une tuile bascule sa sélection et l'affiche dans le panneau (sans le
  vider au second clic) ; hors mode, le clic ne fait que l'afficher, comme avant ; Ctrl+clic (ou Cmd) bascule toujours
  sans toucher au panneau. Quitter le mode garde la sélection. Élagage des pièces sorties de l'inventaire : ajusté
  pendant le rendu quand `uiById` change (motif « état précédent » de React) plutôt que dans un `useEffect`, qui
  ajoutait un avertissement `set-state-in-effect` au lint ; même effet, sans une image où la carte chiffrerait un id
  disparu. `VirtualGearGrid.tsx` : `selection` + `onToggleSelect` STABLE sur le modèle de `excludedPieces` /
  `onToggleExclude`, `GearTile` reçoit `selected` (booléen) et ne se re-rend que si sa propre sélection change ; le
  clic de l'écran (`onSelect`) ne change qu'avec le mode. Tuile sélectionnée : coche ambre dans le coin haut gauche
  (`z-10`, par-dessus le bord de l'« E » d'équipement), l'exclusion garde son style ; le `title` dit « selected
  (Ctrl+click to unselect) » et/ou « excluded from the solver ». Sans les champs de rebut dans les tables, la grille ne
  reçoit pas la sélection (pas de coche orpheline sans carte).
- ✅ **Supprimé.** `ScrapLine`, `SCRAP_MATERIALS_SHOWN` et le `useMemo` `scrap` de G74 (`InventoryScreen.tsx`) ; la
  ligne sous `SortHeader` disparaît. En-tête de `scrapValue.ts` remis à jour (la carte, plus la ligne).
- ✅ **Docs.** `wiki/Using-the-App.md` : Inventory › Scrap value décrit la carte, nouvelle puce « Selecting pieces ».
  `docs/release-notes.md` (notes de la 1.21.0 déjà publiée, qui parlent de la ligne) laissé tel quel. Aucun item de
  `docs/todo.md` ne correspondait.
- ✅ **Tests.** `apps/renderer/test/scrapCard.test.ts` (8) : `scrapScope` (sélection vide → vue et « 2 shown » ;
  sélection → ses pièces même hors vue, « 2 selected » ; id disparu non compté) ; `materialRows` (nom et icône depuis
  `items`, inconnu → `item 600` et `null`, sans table → icônes nulles) ; `toggleSelection`, `addAll`, `pruneSelection`
  (`Set` neuf, entrée intacte, même `Set` quand rien ne change, pièce disparue retirée). `npm run typecheck` : `tsc
  --noEmit` sans erreur ; `npm test` : `Tests  169 passed (169)`, `Tests  237 passed (237)`, `Tests  850 passed
  (850)` ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, comme avant.
- ⏳ **Laissé.** Comme pour la ligne de G74, le filtre de slot (SlotBar) ne compte pas dans `activeFilterCount` : un
  slot seul ne fait pas apparaître la carte (une sélection, oui). Aucun test d'écran sur le clic en mode sélection
  (le runtime de `inventoryScreen.test.ts` ne lit que des props) ; le rendu de la carte n'est vérifié que par typecheck.
- ⏳ **Sevih** : sur le desktop avec un `equipment.json` à champs de rebut, Inventaire › « Scrap candidates » → la carte
  sous le panneau (icônes or et matériaux, « +n more »), puis Select pieces, clics, Ctrl+clic hors mode, Select all
  shown, Select excluded, Clear ; contrôler la coche ambre à côté de l'« E » et la largeur de la colonne. Les notes de
  la prochaine release devront dire que la ligne est devenue une carte.

### 📦 Release : cible Linux AppImage à côté de l'installeur Windows, une seule release, auto-update Linux (G76) (2026-10-30)
- ✅ **Pourquoi.** Après la couche plateforme de G75, l'app tourne sous Linux mais ne se construisait et ne se publiait
  que pour Windows (`win.target nsis`, `electron-builder --win`) : rien à télécharger pour un joueur sous Proton, et
  electron-updater n'avait pas de `latest-linux.yml` à lire.
- ✅ **Bloc `build` d'`apps/desktop/package.json`** (seul bloc touché, scripts et dépendances intacts, `package-lock.json`
  non modifié) : `linux` = `target AppImage` x64, `category Game`, `icon build/icon.png`, `executableName
  outerpedia-gear-solver` (sans lui electron-builder refuse l'AppImage : le nom dérivé `@gear-solverdesktop` est
  invalide), `artifactName "${productName}-${version}.${ext}"`, soit `Outerpedia Gear Solver-1.20.0.AppImage` en local
  et `Outerpedia-Gear-Solver-1.20.0.AppImage` sur GitHub, le même motif que le `Setup` Windows (nom du produit + version),
  sans l'arch puisqu'il n'y en a qu'une. `linux.files` ajoute `build/icon.png` à l'asar : l'icône de fenêtre que
  `main.ts` passe sous Linux (`join(__dirname, "..", "build", "icon.png")`) n'existait sinon qu'en dev ; la build Windows
  ne l'embarque pas. `extraMetadata.desktopName = "outerpedia-gear-solver.desktop"` : Electron en tire l'app_id / le
  WM_CLASS, qui correspond ainsi au `.desktop` de l'AppImage (avertissement d'electron-builder sinon). `publish`
  inchangé.
- ✅ **Icône.** `fetch-binaries.mjs` : `provisionWindowsIcon` devient `provisionIcons` et copie aussi la source vers
  `build/icon.png`. Source = `public/icons/icon-512x512.png` du checkout outerpedia, celle de l'`.ico` : déjà un PNG
  carré 512×512 RGBA, donc copié octet pour octet, sans conversion ni dépendance (pas de PNG source dans `resources/`,
  pas besoin d'Electron hors ligne). Le script affiche `[ok] linux icon 512x512 -> …/build/icon.png`.
- ✅ **`scripts/release.mjs`.** L'étape 6 lance `npm run dist -w @gear-solver/desktop -- --win --linux --publish always`
  (le script `publish` du workspace, `--win` seul, n'est plus appelé et reste en place : les scripts sont hors
  périmètre) : les deux cibles dans une seule exécution, donc la même release brouillon avec `latest.yml` et
  `latest-linux.yml`. `hashInstaller` devient `hashArtifacts` sur une table `ARTIFACTS` (installeur Windows, AppImage
  Linux) ; la correspondance exige la version juste avant l'extension (` 1.20.0.exe`, `-1.20.0.AppImage`) : l'ancien
  `includes(version)` prenait `Setup 1.20.0-private.1.exe`, présent dans `release/` sur le portable, à la place de
  `Setup 1.20.0.exe`. Il manque l'un des deux après la build : l'étape lève une erreur qui nomme le manquant, et le
  `catch` affiche comme avant la marche à suivre pour finir à la main (la release existe déjà sur GitHub à ce stade).
  VirusTotal : `submitToVirusTotal` appelé pour chacun, lien rangé sur l'artefact (`a.vt`, plus de `vtResult` global).
  `integrityNote(artifacts, tag)` : par artefact, le lien de téléchargement
  (`releases/download/<tag>/<nom à tirets>`), le SHA-256, la commande de vérification (`Get-FileHash` pour Windows,
  `sha256sum` pour Linux) et le lien VirusTotal ; le résumé final nomme les deux fichiers. Contrôlé en extrayant
  `hashArtifacts` et `integrityNote` dans un script jetable lancé sur le vrai `release/` (1.20.0 → `Setup 1.20.0.exe`
  et l'AppImage, 1.14.0 → `Setup 1.14.0.exe` et pas `-g45`) ; la release elle-même n'a pas été lancée.
- ✅ **Auto-update Linux.** Lu dans electron-updater 6.8.9 (`AppImageUpdater`) : sans `APPIMAGE` dans l'environnement
  (AppImage extrait, `electron .`), `checkForUpdates` rend null sans aucun événement, donc la carte restait sur « Up to
  date » ; avec `APPIMAGE`, l'installation fait `unlinkSync` du fichier puis `mv` du nouveau dans le même dossier, donc
  un dossier en lecture seule échouait après le téléchargement complet, en « Update check failed / Offline? ».
  `updater.ts` : `appImageUpdateBlocker(platform, env, canWrite)` (pur, `canWrite` injecté) rend la raison, ou null :
  rien hors Linux, « Not started from the AppImage file — download new versions from GitHub » sans `APPIMAGE` absolu,
  « AppImage folder is read-only — move the file to a writable folder » si `accessSync(dirname, W_OK)` échoue. Quand il
  bloque : nouvelle phase `manual` (desktop et miroir `apps/renderer/src/lib/update.ts`), `autoDownload` coupé mais
  la vérification lancée quand même, `update-available` ne fait que noter la version, les événements `checking`,
  `error` et `update-not-available` ne quittent pas `manual`, et `installUpdate` reste refusé (la phase n'est jamais
  `downloaded`). Sinon le chemin d'avant, inchangé : téléchargement en fond, « vX ready », bouton Install →
  `quitAndInstall(false, true)`, qui relance la nouvelle AppImage. `UpdateCard.tsx` : une sixième config ambre « Manual »
  (titre « vX available » ou « Auto-update off », le message en entier et non tronqué, bouton « Check again », icône
  triangle de l'erreur) ; les cinq autres états ne changent pas.
- ✅ **Docs.** `README.md` (phrase « Packaged as… » : Windows et Linux, lien de téléchargement, section « 🐧 Linux (AppImage) » : `chmod +x`,
  `unzip`, option de lancement Proton de G75, mise à jour depuis un dossier inscriptible, nom versionné remplacé par le
  nouveau ; `sha256sum` à côté de `Get-FileHash` ; `dist -- --linux` / `-- --win` dans la build depuis les sources),
  `wiki/Getting-Started.md` (Windows ou Linux, section « Installing on Linux » en quatre étapes), `wiki/Using-the-App.md`
  (carte « Manual »), `docs/architecture.md` et son miroir `wiki/Architecture.md` (publication des deux cibles,
  condition de l'auto-update AppImage). `docs/todo.md` : aucun item ne correspondait.
- ✅ **Tests.** `apps/desktop/test/updater-appimage.test.ts` (6) : `appImageUpdateBlocker` (Windows jamais, sans
  `APPIMAGE` ou relatif, dossier en lecture seule avec le dossier vérifié = `dirname`, dossier inscriptible) ; puis
  `setupAutoUpdate` avec la plateforme forcée à `linux` et sans `APPIMAGE`, sur un faux `autoUpdater` qui garde ses
  écouteurs : `manual` avec la raison et `autoDownload` faux, version nommée par `update-available`, `manual` gardé à
  travers `checking-for-update` / `error` / `update-not-available`, `installUpdate()` faux. `updater.test.ts` (l'échec
  de vérification au lancement) pose un `APPIMAGE` sous `tmpdir()` : sous Linux, hôte de la CI, il serait sinon passé
  en `manual`. `npm run typecheck` : `tsc --noEmit` sans erreur ; `npm test` : `Tests  169 passed (169)`,
  `Tests  237 passed (237)`, `Tests  842 passed (842)` ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, comme
  avant.
- ✅ **Build locale non publiée.** `npm run desktop:build && npm run fetch-binaries -w @gear-solver/desktop && npm run
  dist -w @gear-solver/desktop -- --linux --publish never` : `apps/desktop/release/Outerpedia Gear Solver-1.20.0.AppImage`,
  126 454 342 octets, SHA-256 `a4e27a0dfd0e487070463f95cb81a814ee1a8abbec6fc0fd72209e6fadff88f5` ; `latest-linux.yml` à
  côté (`url: Outerpedia-Gear-Solver-1.20.0.AppImage`, `blockMapSize` : mise à jour différentielle possible) ;
  `app-update.yml` dans `linux-unpacked/resources/`, et l'asar porte `dist/` (44 fichiers), `build/icon.png` et
  `desktopName`. Rien de `release/` n'est commité. L'AppImage n'a pas été lancé.
- ⏳ **Laissé à Sevih.** Lancer l'AppImage sur le portable (icône de fenêtre et du lanceur, carte Home, capture sous
  Proton de G75) ; à la prochaine release, vérifier que la page porte les deux artefacts, `latest.yml` et
  `latest-linux.yml`, puis l'auto-update réel depuis un AppImage dans `~/Applications` (un AppImage 1.20.0 local n'a
  pas de version précédente publiée à partir de laquelle se mettre à jour). La release suivante passe Wine pour le NSIS
  et l'AppImage dans la même commande : durée et place disque à surveiller. Une note joueur dans `docs/release-notes.md`
  reste à écrire (« Linux AppImage »). Hors périmètre : le script `publish` du workspace (`--win` seul) n'est plus utilisé
  par la release, à retirer quand les scripts seront ouverts ; `.rpm` / `.deb` / Flatpak, arm64 et la signature Linux.

### 🐧 Desktop : couche plateforme avec implémentation Linux (Steam natif, jeu sous Proton, chemins Wine) (G75) (2026-10-29)
- ✅ **Pourquoi.** Le desktop ne tournait que sous Windows : Steam trouvé par `reg.exe`, le jeu par `tasklist.exe`, lancé
  par `cmd.exe /c start steam://…`, BepInEx décompressé par PowerShell. Sous Fedora le jeu tourne sous Proton (Steam
  natif, `OUTERPLANE.exe` dans un préfixe Wine) et le même plugin BepInEx marche si l'option de lancement
  `WINEDLLOVERRIDES="winhttp=n,b" %command%` est posée. Pas de cible de build Linux ici (G76).
- ✅ **Couche plateforme.** Nouveau `apps/desktop/src/platform.ts` : interface `Platform` (`registrySteamPath?`,
  `steamRoots`, `gamePids(exe)`, `ownsHeartbeat`, `launchGame(appId)`, `expandZip`, `toPluginPath` / `fromPluginPath`,
  `protonLaunchOptions`), `win32Platform()` (le code d'avant, déplacé tel quel avec `run()`), `linuxPlatform({ home,
  procDir })`, `platformFor(os)` (Linux → linux, le reste → win32), `platform()` et `setPlatform` pour les tests.
  `steam-capture.ts` et `download.ts` ne contiennent plus ni `reg.exe`, ni `tasklist.exe`, ni `cmd.exe`, ni
  `powershell.exe` (`expandZip` a quitté `download.ts`).
- ✅ **Linux.** Racines Steam = `steam.roots.linux` de `game-client.json`, résolues contre `HOME`, la première qui a
  `steamapps` : la table curée les porte déjà (natif, `.steam/steam`, `.steam/root`, les deux formes Flatpak), donc rien
  n'y est ajouté et le code n'en garde pas de seconde liste. `gamePids` lit `/proc/<pid>/cmdline` (un argument dont le nom
  de fichier est `OUTERPLANE.exe` : le processus Wine, et aussi les lanceurs de Proton). `launchGame` = `xdg-open
  steam://rungameid/<appid>` détaché ; `expandZip` = `unzip -o -q`, avec « unzip is not installed — … » si absent.
  `toPluginPath` : `/home/x/…` → `Z:\home\x\…` (le plugin lit sa config dans Wine), `fromPluginPath` l'inverse (autre
  lecteur laissé tel quel) ; `installSteamPlugin` écrit l'`OutDir` traduit, `steamStatus` le relit traduit avant
  `outDirOk` (identité sous Windows).
- ✅ **Écart à la consigne, nécessaire : le heartbeat sous Wine.** Le plugin écrit `Process.GetCurrentProcess().Id`, qui
  sous Wine est le pid Windows de Wine, jamais un pid Linux : la comparaison au pid aurait laissé `live` toujours faux,
  et désarmé la garde du write-back `user_item` et du wipe (`steamPluginLive`). `Platform.ownsHeartbeat` : sous Windows
  la comparaison au pid d'avant ; sous Linux, le heartbeat appartient au jeu quand son `startedAt` suit le démarrage d'un
  des processus du jeu (`/proc/<pid>/stat` champ 22 + `btime` de `/proc/stat`, 100 ticks/s, 2 s de marge) ; un
  heartbeat d'une session précédente est plus ancien et ne compte pas. Le plugin n'est pas touché.
- ✅ **Option de lancement Proton.** `SteamStatus.launchOptionsOk: boolean | null` (desktop et miroir
  `apps/renderer/src/steam.ts`) : lu dans `<steamRoot>/userdata/<id>/config/localconfig.vdf`
  (`UserLocalConfigStore › Software › Valve › Steam › apps › 4247320 › LaunchOptions`, clés sans casse, petit lecteur
  KeyValues `parseVdf` avec échappements et commentaires), vrai si l'un des comptes porte `WINEDLLOVERRIDES` et
  `winhttp=n,b`, faux si aucun, null sous Windows, sans jeu ou sans fichier lisible ; résultat en cache sur taille +
  mtime (fichier gros, statut toutes les 5 s). `SteamSetupPane.tsx` : sous la liste des étapes, une ligne ✓ « Proton
  launch option set » ou un encadré ambre avec la ligne exacte à coller dans Steam › OUTERPLANE › Properties › General ›
  Launch Options et « Steam must be restarted after editing it » ; rien sous Windows (null). `ready` et la pastille
  d'en-tête ne changent pas.
- ✅ **Icône et docs.** `main.ts` : icône de fenêtre `build/icon.png` sous Linux si le fichier existe (sinon rien, le
  fichier est l'affaire de G76). Paragraphe Linux / Proton dans `docs/architecture.md` et son miroir
  `wiki/Architecture.md`, `wiki/Capture-Pipeline.md` (section « Linux (Steam + Proton) ») et
  `tools/capture-steam/README.md` (source de cette page).
- ✅ **Tests.** `apps/desktop/test/steam-linux.test.ts` (12), plateforme injectée : racines (HOME factice, Flatpak seul,
  natif préféré, racine sans `steamapps` sautée, aucune) ; `gamePids` sur un `/proc` factice (le processus Wine et le
  script Proton retenus, un `bash` qui cite OUTERPLANE non, `self` ignoré) ; `ownsHeartbeat` (après le démarrage oui,
  session précédente non, aucun processus non, date vide non) ; traduction aller-retour avec espaces et accents, autre
  lecteur intact ; `localconfig.vdf` factices (aucun, sans l'option, autre option, avec l'option sur un second compte) ;
  `steamStatus` avec une config en `Z:\…` (`outDirOk`, `ready`, `launchOptionsOk`, `live`) puis config native, heartbeat
  périmé, option absente ; `installSteamPlugin` qui écrit l'`OutDir` en `Z:\…`. `steam-status.test.ts` épingle
  `win32Platform()` (une ligne : ses faux `reg.exe` / `tasklist.exe` doivent tourner sur l'hôte Linux de la CI), ses
  assertions sont inchangées. `npm run typecheck` : `tsc --noEmit` sans erreur ; `npm test` : `Tests  169 passed (169)`,
  `Tests  231 passed (231)`, `Tests  842 passed (842)` ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, comme
  avant.
- ⏳ **Laissé.** Sevih teste sur le portable Fedora avec la build de G76 (jeu, Steam et `desktop:dev` jamais lancés
  ici) : à vérifier, la détection du processus et `live` sous Proton réel, la ligne d'option relue après redémarrage de
  Steam, l'`OutDir` en `Z:\…` lu par le plugin. `launchOptionsOk` reste null quand Steam est introuvable ou qu'aucun
  `localconfig.vdf` n'est lisible : l'écran n'affiche alors pas de rappel. Le README annonce encore « Windows » seulement
  (installation Linux : G76).

### 🪙 Inventaire : valeur de rebut des pièces filtrées, vente et désassemblage depuis les tables (G74) (2026-10-29)
- ✅ **Pourquoi.** Demande de Sevih du 29/10 : savoir ce que vaut un lot de rebut avant d'aller le vider en jeu. Quand
  un filtre est posé, une ligne sous la barre de tri dit ce que les pièces affichées rendraient : l'or de leur vente,
  l'or et les matériaux de leur désassemblage. Information seulement, rien n'est cliquable.
- ✅ **Contrat.** `packages/core/src/gamedata.ts` : `EquipmentDef` gagne quatre champs FACULTATIFS (`canSell`,
  `sellPrice`, `canDissolve`, `dissolve: EquipmentDissolve | null`, `{ assets: [{type, min, max}], items: [{id, min,
  max}] }`), publiés par outerpedia (G73) et absents d'un `equipment.json` synchronisé avant eux ; `data/derived/` est
  inchangé.
- ✅ **Calcul.** Module pur `apps/renderer/src/lib/inventory/scrapValue.ts`. `scrapValue(pieces, equipment, items)` suit
  les règles de l'écran « Item clear » du client : vente = `canSell`, +0, ni équipée ni verrouillée ; désassemblage =
  `canDissolve`, ni équipée ni verrouillée (une pièce améliorée se désassemble mais ne se vend pas). Or (`AT_GOLD`) et
  matériaux additionnés par id, min et max séparément, dans l'ordre de première rencontre ; un asset autre que l'or est
  listé sous son type ; nom d'un matériau par `itemLabel` (`item <id>` faute de `items.json`). `enhancedCount` = les
  pièces améliorées parmi les désassemblables (leur remboursement de matériaux d'amélioration n'est pas dans les
  tables : compté, pas estimé) ; `unknown` = pièces sans entrée ou sans les champs. `hasScrapFields(equipment)` dit si
  la table porte les champs ; `formatGold` groupe les milliers par une espace fine insécable (U+202F) sans locale,
  `formatRange` écrit `a` ou `a–b`.
- ✅ **Écran.** `InventoryScreen.tsx` : `ScrapLine` sous `SortHeader`, seulement si `activeFilterCount(f) > 0` et
  `hasScrapFields(game.equipment)` (sinon aucun élément rendu), calculée sur `filtered` (le tri n'y change rien) : «
  Scrap value of these 37 pieces — sell: 12 400 gold (31 sellable) · dissolve: 2 100–3 400 gold, 24–40 × Stage 2
  Enhancement Stone, … (37 dissolvable, 3 enhanced: refund not counted) », « · n not in the game data » s'il y a des
  inconnues ; au-delà de quatre matériaux, « +n more » souligné en pointillé avec le reste en `title`. Texte
  `text-[11px] text-white/70`, aucune autre retouche visuelle.
- ✅ **Docs.** `wiki/Using-the-App.md` (Inventory › Scrap value), `docs/reference.md` et `wiki/Engine-Reference.md`
  (ligne `equipment.json` : les quatre champs facultatifs). Aucun item de `docs/todo.md` ne correspondait.
- ✅ **Tests.** `apps/renderer/test/scrapValue.test.ts` (10) sur des entrées factices : deux pièces libres à +0 (vente
  1 300, or 150–250, matériau commun fusionné 3–7, matériau sans nom → `item 600`) ; équipée et verrouillée exclues des
  deux ; améliorée exclue de la vente, comptée au désassemblage avec `enhancedCount` ; pièce ni vendable ni
  désassemblable (ni comptée ni inconnue) ; entrée sans les champs et item absent → `unknown` ; pas de table d'objets ;
  `hasScrapFields` (vrai sur une table aux champs, faux sur une table sans aucun champ, vide ou absente : la ligne ne
  s'affiche pas) ; `formatGold` / `formatRange`. `npm run typecheck` : `tsc --noEmit` sans erreur ; `npm test` : `Tests
  169 passed (169)`, `Tests  219 passed (219)`, `Tests  842 passed (842)` ; `npm run lint` : `✖ 13 problems (0 errors,
  13 warnings)`, comme avant.
- ⏳ **Laissé.** La règle du client teste `EnchantExp == 0`, la pièce capturée ne porte que son niveau : une pièce à +0
  avec de l'Exp partielle compte ici comme vendable alors que le jeu la refuse (cas rare ; `GearPiece` n'expose pas
  l'Exp, l'y ajouter touche `parse.ts`). Le remboursement d'amélioration reste dit, pas calculé. Le filtre de slot
  (SlotBar) ne compte pas dans `activeFilterCount` : un slot seul ne fait pas apparaître la ligne.
- ⏳ **Sevih** : la ligne n'apparaît qu'après la synchronisation d'un `equipment.json` portant les champs (G73 côté
  outerpedia) ; ensuite, Inventaire › filtre « Scrap candidates » → vérifier la ligne contre l'écran « Item clear » du
  jeu (or de vente, or et matériaux du désassemblage).

### 📋 Presets locaux : enregistrés dans GS depuis le Builder ou par copie d'un preset du jeu, listés dans l'onglet Presets (G72) (2026-10-29)
- ✅ **Pourquoi.** Demande de Sevih du 29/10 : préparer des presets sans toucher au jeu, pour les retrouver plus tard. Un
  preset local = un nom (1 à 12 caractères, la limite du jeu, pour qu'il puisse un jour porter le même nom en jeu) et
  huit emplacements dans l'ordre du fil, EE toujours à "0". Rien n'est écrit vers le jeu, et un preset local ne retient
  aucune pièce pour le solveur.
- ✅ **Stockage.** `apps/renderer/src/lib/storage/localPresets.ts`, clé `gs.presets.local` (une liste, comme
  `gs.inv.filterPresets`) : `{ id, name, itemUids (8, fil), heroUid | null, createdAt }` ; `loadLocalPresets` (plus
  récent d'abord, entrée mal formée ignorée, EE remise à "0" à la lecture, stockage illisible = liste vide),
  `addLocalPreset` (nom trimé, refusé hors 1..12 ou liste ≠ 8), `renameLocalPreset`, `removeLocalPreset`,
  `isReadableLocalPreset` (garde de l'import), `wireUidsFromBuild` (ordre moteur weapon, helmet, armor, gloves, boots,
  accessory, exclusive, ooparts → ordre du fil weapon, accessory, helmet, armor, gloves, boots, EE, ooparts ; EE à "0")
  et `localCopyOf` (pièces d'un preset du jeu rangées par leur slot d'inventaire, sinon par leur position sur le fil ;
  EE à "0" ; nom coupé à 12 caractères, « Preset #num » pour un preset sans nom). Pas de limite de nombre.
- ✅ **Création.** Builder (`RightSidebar.tsx`, panneau Library, sous « Save build + filter preset ») : « Save as local
  preset… » ouvre un champ inline (12 caractères, Save, Échap ou ✕ pour annuler) ; `BuilderScreen.tsx`
  `saveLocalPreset` enregistre les 7 pièces du résultat sélectionné (sans l'EE) et le héros du Builder en référence ; une
  ligne verte dit ce qui a été enregistré. Onglet Presets : « Copy as local preset » dans l'en-tête de chaque carte du
  jeu (désactivé sur un preset vide, « Copied ✓ » après), héros de référence = celui que la carte affiche (choisi, sinon
  le porteur unique proposé).
- ✅ **Onglet Presets** (`PresetsScreen.tsx`). Section « Local presets » sous les presets du jeu : titre, compte (avec «
  · N shown » sous un filtre de classe, qui s'applique aussi aux presets locaux ; ordre toujours de création, plus
  récent d'abord), une ligne discrète quand il n'y en a aucun ; l'onglet ne montre plus « No presets » quand la capture
  n'a aucun preset du jeu mais qu'il existe des presets locaux. Chaque preset local a la même `PresetCard`, construite
  sur une ligne synthétique : `localPresetRows(locals, inventory)` (`lib/presets/presetRows.ts`) fabrique un `Preset`
  à `num` négatif (−1, −2… par position, jamais un numéro du jeu ni une clé `gs.presets.*`, qui ne voient jamais ces
  lignes) et pose `PresetRow.localId` ; `presetRows` est inchangé (le calcul commun est sorti dans `indexInventory` /
  `toRow`). Pièces résolues contre l'inventaire, pièce manquante marquée, « Worn by » ; aucune pièce n'y est « shared »
  (un preset local ne tient rien en jeu). Sur la carte locale : badge « Local », ni rang, ni numéro, ni favori, ni
  verrou, ni héros associés, ni « + Worklist » (il réserverait des pièces), ni « Optimize preset → » ; la ligne du héros
  de référence avec son évaluation et « Optimize → » (sinon « No reference hero ») ; Rename inline (12 caractères) et
  Delete en deux clics (le bouton devient « Delete? », revient à « Delete » en perdant le focus).
- ✅ **Solveur.** `presetHolds` ne lit que `inventory.presets` : les presets locaux n'entrent ni dans
  `presetBlockedUids` ni dans `presetHoldersOf` (un test le fixe).
- ✅ **Sauvegarde.** `lib/storage/transfer.ts` : `localPresets` dans le bundle (absent d'une ancienne sauvegarde = aucun,
  autre chose qu'une liste refusé), fusion par id (l'entrée locale gagne), une entrée que `loadLocalPresets` ignorerait
  n'est ni fusionnée ni comptée (modèle G70) ; `ImportResult.localPresets`, ajouté au message d'import de
  `BackupPane.tsx` (« , N local presets ») et à la description de l'export.
- ✅ **Docs.** `wiki/Using-the-App.md` (Presets › Local presets, Builder › Save as local preset…, Settings › Backup),
  `docs/architecture.md` et `wiki/Architecture.md` (onglet Presets), `docs/reference.md` et `wiki/Engine-Reference.md`
  (§1.6 : les presets locaux n'entrent pas dans les holds ; arbre de `storage/`). Aucun item de `docs/todo.md` ne
  correspondait.
- ✅ **Tests.** `apps/renderer/test/localPresets.test.ts` (10) : aller-retour (plus récent d'abord, nom trimé, EE à
  "0"), nom de 13 caractères / vide / liste de 7 refusés, rename (trimé, 13 caractères refusé, id inconnu) et remove,
  entrées mal formées ignorées et stockage illisible ; conversion moteur → fil d'un `SolveBuild` factice (chaque uid à
  son index, EE à "0", slot vide à "0") ; copie d'un preset du jeu (EE à "0", nom coupé à « A very long », preset sans
  nom → « Preset #7 », liste courte rangée par slot) ; `localPresetRows` (num −1/−2 et `localId`, pièce manquante avec
  son slot du fil, rien de partagé avec le preset du jeu qui tient les mêmes pièces, porteur, `presetRows` inchangé) ;
  `presetBlockedUids` ignore un preset local enregistré. `apps/renderer/test/transfer.test.ts` (+3) : export de la
  liste, import des seuls ids nouveaux, ne compte que le lisible, sauvegarde sans le champ, liste mal formée refusée.
  `npm run typecheck` : `tsc --noEmit` sans erreur ; `npm test` : `Tests  169 passed (169)`, `Tests  219 passed
  (219)`, `Tests  832 passed (832)` ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, comme avant.
- ⏳ **Hors périmètre, laissé.** Le tableau des tests de `docs/reference.md` / `wiki/Engine-Reference.md` ne liste pas
  `localPresets.test.ts` (son compte est déjà en retard, reste noté de G70). L'édition pièce par pièce d'un preset
  local, l'envoi vers le jeu et le tri restent à décider.
- ⏳ **Sevih, sur le fixe** : Builder › un résultat › « Save as local preset… » → nom → Save ; onglet Presets › la carte
  « Local » sous les presets du jeu, avec le héros du Builder et « Optimize → » ; « Copy as local preset » sur une carte
  du jeu ; Rename, Delete → « Delete? » ; Settings › Backup › Export puis Import sur une base vide → « , N local
  presets » dans le message.

### 💎 Transistone : une pièce qui a déjà un palier 4 peut encore monter une ligne au palier 3 (G71) (2026-10-29)
- ✅ **Pourquoi.** Règle redite par Sevih le 29/10 : une pièce sans ligne au palier 4 peut en monter UNE au palier 4 ;
  une pièce qui en a déjà une ne peut pas en recevoir une deuxième, mais peut monter une ligne au palier 3 (4/4/3/2 →
  4/4/3/3, 3/3/3/3 → 4/3/3/3). `rerollGains` rendait null dès qu'une ligne était au palier 4 : une 4/4/3/2 sortait de
  « Reachable › Perfect » et perdait sa projection Transistone dans le Builder. C'est la conséquence directe de la règle
  du client déjà notée en tête du module (MaxCount 1 pour le niveau 3 = palier 4, niveaux 0/1/2 sans limite) ; le
  commentaire d'en-tête le dit maintenant.
- ✅ **Comment.** `apps/renderer/src/lib/solver/reroll.ts` : palier cible 4 sans ligne au palier 4, 3 sinon ; par ligne
  `max(0, min(cible − baseStage, cap LV6))` ; null seulement si la pièce est inéligible. Une 4/4/3/3 ou une 4/3/3/3
  rend des gains tous à 0 : `rerollMaxGain` 0, `reachable` absent, `rerollPotential` null, comme avant. Choix de la ligne
  inchangé ; `applyRerollPotential` monte bien la ligne de `pot.ticks` (pas « jusqu'à 4 » en dur), donc rien à y changer
  hors commentaire. Textes d'accord : `QUALITY_REACHABLE_HELP` (`lib/quality.ts`), infobulle « Transistone potential »
  de `BuilderToolbar.tsx`, commentaires de `quality.ts`, `types.ts`, `builderFilters.ts`, `engine.ts` et
  `screens/inventory/filters.ts` ; `wiki/Using-the-App.md` (« Reachable quality » et « Transistone potential », avec les
  deux exemples de Sevih), `wiki/Engine-Reference.md` et ses miroirs `docs/reference.md`, `docs/solver.md`.
- ✅ **Tests.** `apps/renderer/test/reroll.test.ts` (20) : 4/4/3/2 → gains [0,0,0,1], max 1 ; 3/3/3/3 → [1,1,1,1], max 1 ;
  4/4/3/3 et 4/3/3/3 → gains tous 0, max 0 ; 4/4/1/1 → [0,0,2,2] ; 5★ et 3 lignes → null ; plafond LV6 respecté à côté
  d'une ligne au palier 4 sur des lignes reforgées ; projection d'une ligne reforgée de base 1 → 3 (pas 4) à côté de
  deux paliers 4. `apps/renderer/test/quality.test.ts` : 4/4/3/2 → `reachable` 14/14, palier Perfect ; le test de
  signature passe le gain de 1 de la 5/4/4/2 ; la comparaison aux trois anciennes copies (sans potentiel Transistone)
  porte sur le score courant, `reachable` mis de côté — ses dispositions synthétiques ont toutes une ligne ≥ 4 et
  comptaient sur l'ancien null. `npm run typecheck` : `tsc --noEmit` sans erreur ; `npm test` : `Tests  169 passed
  (169)`, `Tests  219 passed (219)`, `Tests  819 passed (819)` ; `npm run lint` : `✖ 13 problems (0 errors, 13
  warnings)`, comme avant.
- ⏳ **Sevih, sur le fixe** : Inventaire › Reachable quality › Perfect → une 4/4/3/2 6★ Legendary y apparaît ; Builder ›
  « Transistone potential » → sa ligne au palier 2 porte `T+1`, une 4/4/3/3 ne bouge pas.

### 🐞 Inventaire : drill de Home respecté, preset de filtres visible hors portée, recherche gardée au Load, compte d'import exact (G70) (2026-10-29)
- ✅ **Quoi.** Les quatre (b) de l'audit G69, tranchés par Sevih le 29/10. Chaque rejeu du todo est devenu un test qui
  échoue sans la correction, puis passe.
- ✅ **Drill de Home.** `apps/renderer/src/screens/inventory/InventoryScreen.tsx` : au montage, l'effet du drill et
  l'auto-prune tournaient dans le même commit ; l'updater de l'auto-prune recevait l'état posé par le drill
  (`quality = {excellent}`, onglet All) avec les disponibilités de l'onglet et des emplacements quittés (session) et
  élaguait le palier : grille All non filtrée. L'auto-prune porte maintenant `if (drill) return;` et `drill` dans ses
  dépendances (seule exception à la note « À NE PAS toucher » du todo) : il repasse au rendu suivant, drill consommé,
  dans la portée du drill. Test : Inventaire laissé sur Special avec la puce Talisman, drill sur le palier d'un casque
  → onglet All, `quality` = ce palier, aucun emplacement ; échouait (`Set{}`), passe.
- ✅ **Preset hors de la portée affichée.** (i) `InventoryScreen.tsx` : l'Apply de la modale passe par `applyFilters`,
  qui bascule sur l'onglet All quand le filtre porte un emplacement absent de `TAB_SLOTS[tab]` ; la `SlotBar` montre
  alors la puce. Voie la plus simple retenue : l'écran déduit l'onglet du filtre appliqué, la modale ne change pas
  d'API (pas d'`onTabChange`) ; seul un preset chargé peut porter un tel emplacement (la modale n'a pas de pilule
  d'emplacement, `setTab` élague les autres), et la bascule se fait à l'Apply, un Cancel laisse l'onglet.
  Test : preset `slots = {talisman}` appliqué sur Gear → onglet All, puce Talisman ; échouait (`gear`), passe ; un
  preset Casque sur Gear y reste. (ii) `FilterModal.tsx` : une valeur sélectionnée dans le brouillon mais absente des
  disponibilités reste rendue, à la suite des disponibles, en `opacity-50` avec le `title` « No piece in the current
  view », et cliquable pour la retirer : Main et Sub (`StatPillGrid`, prop `unavailable`), Set et Class (la section
  s'affiche aussi quand seule une valeur sélectionnée la remplit ; le nom d'un set hors vue vient de la nouvelle prop
  `armorSetName`, `game.sets` puis `Set #id` comme dans l'écran), Star, Grade, Quality et Reachable (`pillAvailability` :
  non sélectionnée et indisponible, la pilule reste grisée et inerte comme avant). Aucun élagage ajouté à l'Apply.
  Test `apps/renderer/test/inventoryFilterModal.test.ts` (4, rendu serveur, portail remplacé par ses enfants) : Sub
  EFF hors vue ; Main SPD, Class Healer, Set « Swift » hors vue (le Set disponible non marqué) ; 5★, Epic et Perfect
  (Quality et Reachable) cliquables et marqués ; sans sélection, 4★ reste inerte et rien n'est marqué. Les trois
  premiers échouaient, passent.
- ✅ **Load garde la recherche.** `PresetsRow.load` : `onLoad({ ...filters, query: draft.query })`, pour un preset de
  l'utilisateur comme pour « Scrap candidates » ; le preset ne stocke toujours pas la recherche. Test : brouillon
  « boots », Load d'un preset Talisman → emplacements du preset, recherche « boots » ; échouait (`""`), passe.
- ✅ **Compte d'import.** `lib/storage/transfer.ts` : `mergeListMap` prend un prédicat `accept` ; les presets du Builder
  passent par `isReadableFilterPreset` (nouveau, `filterPresets.ts` : `fromSerialized` ne lève pas), ceux de
  l'Inventaire par `isReadableInventoryPreset` (nouveau, `inventoryFilterPresets.ts` : forme, `validPresetName` et
  `filters` lisibles). Une entrée refusée n'est ni fusionnée ni comptée, et un héros sans entrée neuve ne reçoit plus
  de liste vide. Test `apps/renderer/test/transfer.test.ts` (+3) : preset `{ id, name }` sans `filters` → compte 0,
  carte `{}` ; à côté d'un preset lisible → 1, seul lui écrit ; six presets d'Inventaire invalides (nom vide, 25
  caractères, nom du preset fourni, sans `filters`, JSON cassé, tableau) → 0, rien d'écrit. Échouaient (1, 2, 6),
  passent.
- ✅ **Banc des effets.** `apps/renderer/test/inventoryScreen.test.ts` (nouveau, 4) : vitest tourne sans DOM, donc
  `react` y est remplacé par un petit moteur de hooks (emplacements `useState` / `useMemo` / `useCallback` / `useRef`,
  effets lancés dans l'ordre de déclaration après le rendu, comme un commit, re-rendu tant qu'un état change) ; le
  composant est appelé comme une fonction et l'arbre rendu ne sert qu'à lire les props de `SlotBar` et `FilterModal`,
  ou à appeler celles de `PresetsRow`.
- ✅ **Docs.** `docs/todo.md` : les quatre (b) retirées, la (c) restante gardée. `wiki/Using-the-App.md` (Presets :
  Load garde la recherche, bascule sur All à l'Apply, valeur hors vue grisée et retirable). `docs/release-notes.md ›
  [Unreleased]` (trois lignes).
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` (sans erreur, code 0) ; `npm test` → core « Tests 169
  passed (169) », desktop « Tests 219 passed (219) », renderer « Tests 811 passed (811) » (dernière ligne) ;
  `npm run lint` → « ✖ 13 problems (0 errors, 13 warnings) », même compte qu'avant (fichier par fichier aussi).
- ⏳ **Laissé, hors périmètre** : l'auto-prune tourne toujours à chaque changement de portée, Apply compris : un preset
  qui change les emplacements ou l'onglet perd, sans le dire, une valeur absente de la nouvelle portée (ex. Casque +
  sub EFF sans casque EFF). Le cas du todo (même portée) est couvert ; ce cas-là touche l'auto-prune, à trancher.
  `docs/reference.md` donne encore « 8 tests » pour `transfer.test.ts` (déjà faux avant ce lot).
- ⏳ **Sevih** sur le fixe : Home › clic sur un palier avec l'Inventaire laissé sur Special Gear → liste filtrée sur le
  palier ; un preset enregistré sur Special Gear chargé sur Gear → bascule sur All à l'Apply.

### 🐞 Audit de bugs sur `main` (1.19.0) : deux corrections sûres, le reste au todo (G69) (2026-10-29)
- ✅ **Méthode.** Lecture du code récent (G61 à G68) puis des modules listés (Inventaire, clés `gs.*`, presets, solveur,
  desktop, `parse.ts`) ; chaque soupçon prouvé par un test vitest ou un rejeu `npx tsx` sur les vrais modules avec des
  données factices avant d'être écrit. Classement : (a) sûr et petit → corrigé ici ; (b) prouvé mais plus large ou à
  trancher, (c) plausible non prouvé → `docs/todo.md`, section « Bugs trouvés par l'audit du 2026-10-29 (G69) ».
- ✅ **(a) Presets du Builder : une entrée illisible ne cache plus toutes les autres.**
  `apps/renderer/src/lib/storage/filterPresets.ts` `loadFilterPresets` : une seule entrée sans `filters` (sauvegarde
  retouchée à la main, fusionnée par `applyBackup`, qui n'exige qu'un `id`) faisait lever `fromSerialized`
  (`f.excludedHeroes` sur undefined) et le `catch` global rendait `{}` : plus aucun preset au Builder, et le premier
  « Save » suivant écrivait cette carte vide par-dessus les bons. Rejeu `npx tsx` : un preset local, import d'un
  `{ id: "x", name: "broken" }` → message « 1 preset », puis `loadFilterPresets()` → aucune clé. Correction : chaque
  entrée passe par un `try`, une entrée qui lève est sautée (`flatMap`). Test `apps/renderer/test/filterPresets.test.ts`
  (+2 : entrée sans `filters` sautée, les autres héros et presets chargés ; import d'une sauvegarde abîmée qui laisse
  le preset local lisible) : 2 échecs sans la correction, 12/12 avec.
- ✅ **(a) Date des fichiers exportés en heure locale.** `design/settings/BackupPane.tsx` (`gear-solver-backup-…`) et
  `screens/home/ExportRosterButton.tsx` (`outerpedia-roster-…`) prenaient `toISOString().slice(0, 10)`, le jour UTC :
  exporté à 00:30 à Paris le 30/10, le fichier s'appelait `…-2026-10-29.json` (rejeu `TZ=Europe/Paris`). Nouveau
  `apps/renderer/src/lib/dateStamp.ts`, `localDateStamp(ms)` (`getFullYear` / `getMonth` / `getDate`), appelé aux deux
  endroits. Test `apps/renderer/test/dateStamp.test.ts` (2) : Paris 00:30, l'ancienne expression y rend le 29
  (assertion gardée dans le test) et `localDateStamp` le 30 ; Los Angeles 23:30 (UTC au lendemain) → le jour même.
- ✅ **(b) et (c) : 4 (b), 2 (c)**, au todo. Le plus lourd : un clic sur un palier de Home peut ouvrir l'Inventaire
  non filtré (l'auto-prune élague le drill avec les disponibilités de l'onglet quitté). Puis : un preset de filtres
  appliqué hors de sa portée (emplacement d'un autre onglet, Main / Sub / Set / Class absents) vide la grille sans
  puce visible ; Load efface la recherche en cours ; l'import compte des entrées que le chargeur jette. En (c) : la clé
  `num` des presets du jeu quel que soit `PresetType`, l'auto-prune sur un inventaire pas encore chargé.
- ✅ **Examiné sans rien trouver** (pour ne pas refaire) : `screens/inventory/filters.ts` (codec, `readBaseRolls` et les
  formes G62 / G65, champs Set ou booléens absents d'une session ancienne, `activeFilterCount` qui compte chaque
  dimension — les emplacements exceptés, voulu —, `reachableTier`, Base rolls `not` et talismans) ;
  `lib/storage/inventoryFilterPresets.ts` (lecture tolérante, écrasement par nom) ; `hooks/usePersistedState.ts`
  (`jsonWithSets`, valeur illisible → défaut) ; les autres clés `gs.*` : `rankPriority` / `heroPriority` /
  `presetPriority` (rang non numérique lu « non classé », compactage), `excludedPieces`, `savedBuilds` (migrations),
  `heroFilters`, `presetHeroes`, `worklist` (garde de forme, un par héros), `dataHash` (élagage), `transfer`
  (fusions) ; les effets qui écrivent ce qu'ils lisent (remplissage des rangs de Builds et Presets : converge en un
  passage, `seen` persisté ; auto-prune : rend `prev` à taille égale, pas de boucle) ; `RankInput` ;
  `lib/presets/presetHolds.ts` (`presetBlockedUids`, tri ∞ − ∞ = NaN rattrapé par `|| a - b`) et le pool de gemmes
  (mêmes règles que le pool de pièces ; `bestEeGemsFor` sans rangs ni verrous, déjà assumé le 27/10) ;
  `lib/solver/reroll.ts` et `lib/quality.ts` (éligibilité, plafond LV6, `reachable` borné au max) ; desktop : routes
  d'`api-handler.ts` (chaque promesse a son `catch` ; `readBody` sans écouteur `error` ne fait pas tomber le serveur,
  Node n'émet `error` sur la requête que si quelqu'un l'écoute), `equip-events.ts` (pliage idempotent, lignes
  déchirées, uids ≤ 2^53 : les uids réels plafonnent vers 6·10⁹), `data-sync.ts` (tout ou rien, facultatif sur 404
  seulement ; le hash d'outerpedia couvre `items.json`, sa publication a bien changé le hash, donc pas de cache
  « fresh » qui l'ignore), `updater.ts` (rejets attrapés) ; renderer : promesses du suivi de capture et de la synchro
  (toutes absorbées) ; `packages/core/src/parse.ts` (ticks toujours posés, uids de preset en chaîne).
- ✅ **Docs** : `docs/release-notes.md › [Unreleased]` (deux lignes). Aucun passage de `docs/` ou `wiki/` rendu faux (les
  tables de tests de `reference.md` ne listent ni `filterPresets.test.ts` ni les exports).
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` (sans erreur, code 0) ; `npm test` → core « Tests 169
  passed (169) », desktop « Tests 219 passed (219) », renderer « Tests 800 passed (800) » (dernière ligne) ;
  `npm run lint` → « ✖ 13 problems (0 errors, 13 warnings) », même compte qu'avant.
- ⏳ **Sevih** : trancher les quatre (b) du todo (le drill de Home d'abord) ; sur une capture avec des presets Master
  League, regarder si des `Num` se recoupent avec les presets classiques.

### 🎯 Inventaire : filtre « Reachable quality », le palier atteignable avec une Transistone (G68) (2026-10-29)
- ✅ **Pourquoi.** Le détail d'une pièce affiche déjà « → N reachable » (score avec la meilleure ligne montée au stade 4
  par une Transistone) mais rien ne permettait de trier l'inventaire sur ce potentiel : une 6★ Legendary « Good » qui
  passerait « Excellent » après un reroll se noyait dans les autres « Good ».
- ✅ **Filtre** (`apps/renderer/src/screens/inventory/filters.ts`) : `FilterState.reachable: Set<QualityTier>`, vide par
  défaut, ajouté à la liste des Sets de `FILTER_CODEC` (sinon perdu au rechargement et dans les presets de G67) et
  compté par `activeFilterCount`. `reachableTier(p)` exportée : `qualityTierFromScore(q.reachable ?? q.current, q.max)`
  quand `p.quality` existe, null sinon — une pièce sans potentiel compte à son palier courant, une pièce sans score
  (talisman, EE, non tirée) ne passe jamais le filtre, comme pour Quality. `matchesFilters` : sémantique OR sur les
  paliers cochés. Une session ou un preset enregistrés avant lisent le défaut vide.
- ✅ **Modale** (`FilterModal.tsx`) : section « Reachable quality » juste sous la rangée Class restriction / Quality,
  mêmes pilules (`QUALITY_TIERS`, couleurs `QUALITY_TONE`), `title` = `QUALITY_REACHABLE_HELP`. `InventoryScreen.tsx`
  calcule `availableReachable` dans la même passe que `availableQualities` (pilules grisées hors de la vue) et élague
  la sélection devenue indisponible dans le même effet que les autres dimensions.
- ✅ **Docs** : `wiki/Using-the-App.md` (paragraphe Reachable quality sous la liste des filtres).
- ✅ **Tests** `apps/renderer/test/inventoryReachable.test.ts` (6) : une 6★ Legendary 3/3/3/2 « good » (11/14,
  atteignable 13/14 = 93 %) gardée par `reachable = {excellent}` et rejetée par `quality = {excellent}` ; une pièce
  sans potentiel (ligne déjà au stade 4, ou 5★) a pour `reachableTier` son palier courant ; un talisman ne passe pas ;
  aller-retour du codec avec `reachable` rempli, ancien filtre sans le champ lu vide ; `activeFilterCount` compte le
  filtre. `npm run typecheck` : `tsc --noEmit` sans erreur (dernière ligne) ; `npm test` : `Tests  796 passed (796)`
  (renderer, dernière ligne ; core 169, desktop 219) ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`,
  comme avant.
- ⏳ À voir par Sevih : la section en jeu (placement sous Quality, grisage des pilules) sur un vrai inventaire.

### 💾 Inventaire : presets de filtres enregistrables (Load / Save as… / Delete) et preset fourni « Scrap candidates » (G67) (2026-10-29)
- ✅ **Pourquoi.** Le tri du rebut repose chaque jour sur le même jeu de filtres (5★ / 6★, Base rolls `not` + « at
  least 3/3/3/X », +0, T0, non reforgée, sans les pièces portées) qu'il fallait recocher à la main ; et tout autre jeu
  de filtres récurrent se reconstruisait de zéro.
- ✅ **Module** `apps/renderer/src/lib/storage/inventoryFilterPresets.ts` : clé localStorage `gs.inv.filterPresets`,
  liste globale (pas par héros, contrairement à `filterPresets.ts` du Builder, non réutilisé) de
  `{ id, name, filters, createdAt }` où `filters` est la chaîne de `FILTER_CODEC.serialize`, `query` vidée à
  l'enregistrement. Lecture tolérante : une entrée sans id / nom / chaîne / date, au nom invalide, ou dont la chaîne
  n'est pas un objet JSON est ignorée ; `FILTER_CODEC.deserialize` à la lecture, donc un preset enregistré avant un
  champ du filtre lit son défaut actuel. `validPresetName` : nom rogné de 1 à 24 caractères, le nom du preset fourni
  refusé. `saveInventoryFilterPreset(name, filters)` écrase sur place (même id, même rang) le preset du même nom, sinon
  ajoute en fin de liste (`crypto.randomUUID()`) ; `deleteInventoryFilterPreset(id)` ; `loadInventoryFilterPresets()`
  dans l'ordre d'enregistrement.
- ✅ **Preset fourni** `SCRAP_CANDIDATES` : défini en code sur `emptyFilters()` (il suit le filtre), jamais stocké,
  `filters()` rend des Sets neufs à chaque appel : étoiles 5 et 6, Base rolls `{ op: "gte", lines: [3, 3, 3, null],
  not: true }`, `enhanceZero`, `breakthroughZero`, `notReforged`, `showEquipped: false`. Son `title` : « Keeps the
  unequipped 5★ and 6★ gear at +0, T0 and never reforged that lacks three sub lines at base tier 3 or better. »
- ✅ **Modale** (`FilterModal.tsx`) : `PresetsRow`, une rangée « Presets » entre l'en-tête et le corps : sélecteur
  (« — », « Scrap candidates », puis les presets de l'utilisateur ; le `title` du preset fourni sur l'option et sur le
  sélecteur quand il est choisi), `Load` remplace le draft (Apply reste à faire), `Save as…` ouvre un champ inline
  (`maxLength` 24, Entrée enregistre, Échap ferme le champ sans fermer la modale) avec Save (désactivé sur un nom
  invalide, `title` « Overwrites the preset of the same name. » quand le nom existe) et Cancel, `Delete` à droite,
  actif sur un preset de l'utilisateur seulement. La liste est relue à chaque ouverture de la modale (la rangée ne
  monte qu'ouverte). Un preset porte tout `FilterState` (emplacements compris) sauf la recherche ; l'onglet All / Gear
  / Special n'en fait pas partie.
- ✅ **Sauvegarde** (`lib/storage/transfer.ts`) : `BackupBundle.inventoryFilterPresets` (facultatif, une sauvegarde
  antérieure se lit sans), exporté par `buildBackup` ; à l'import, une entrée dont l'id OU le nom existe déjà est
  sautée (l'entrée locale gagne, comme pour les builds), le reste copié tel quel ; `ImportResult.inventoryPresets`.
  `design/settings/BackupPane.tsx` additionne ce compte à celui des presets du Builder dans le message d'import (même
  libellé « N presets »).
- ✅ **Tests** : `apps/renderer/test/inventoryFilterPresets.test.ts` (9 cas) : aller-retour d'un `FilterState` à Sets
  (emplacements, étoiles, sous-stats en AND, sets, Base rolls `not`, recherche vidée, chaîne stockée), entrées invalides
  ignorées (null, sans filtres, JSON cassé, tableau, nom vide ou de 25 caractères) et stockage illisible, entrée d'avant
  un champ, nom repris écrasé sur place, noms refusés (vide, 25 caractères, celui du preset fourni ; 24 accepté),
  suppression ; « Scrap candidates » par `matchesFilters` sur des `UiPiece` du fil : 6★ 2/2/1/0 et 6★ 3/2/2/1 libres à
  +0 T0 non reforgées gardées, 6★ 3/3/3/0, 5★ 2/2/2/2 +3, 4★ 1/1/1/1 et un talisman rejetés, une pièce portée
  rejetée. `apps/renderer/test/transfer.test.ts` (+2) : export de la liste, import qui ne prend que l'entrée neuve
  (id et nom déjà présents sautés), sauvegarde sans le champ.
- ✅ **Docs** : `wiki/Using-the-App.md` (puce « Presets » dans l'Inventaire, la note de relance dit que les presets
  restent, la ligne Backup cite les presets de l'Inventaire) ; `docs/release-notes.md › [Unreleased]` une ligne.
  `docs/todo.md` n'avait pas d'item correspondant : inchangé.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` (sans erreur, code 0) ; `npm test` → core « Tests 169
  passed (169) », desktop « Tests 219 passed (219) », renderer « Tests 790 passed (790) » ; `npm run lint` → « ✖ 13
  problems (0 errors, 13 warnings) », même compte qu'avant. Pas de rendu réel possible ici (ni `npm run dev` ni
  Electron) : la rangée n'a été vérifiée qu'à la lecture.
- ⏳ **Sevih** sur le fixe : Inventaire › Filter › Presets › « Scrap candidates » › Load › Apply → la liste du rebut
  attendue ; Save as… un jeu de filtres, fermer, rouvrir, Load ; reprendre le même nom (écrasé) ; Delete ; la rangée
  à juger à l'œil (largeur du sélecteur, champ nom inline) ; une sauvegarde Settings › Backup qui ramène les presets.

### 🔎 Inventaire : filtre « Base rolls » en toutes lettres avec inversion `not`, talismans et EE exclus, cases « +0 only » / « T0 only » / « Not reforged » (G66) (2026-10-29)
- ✅ **Pourquoi.** Essai de G65 sur le fixe (29/10) : les symboles ≥ > = ≤ < se lisent mal dans le sélecteur ; la
  recherche la plus fréquente, « tout ce qui n'a pas au moins trois lignes à 3 de base », ne s'écrivait pas (« < 3/3/3/X »
  jette une 3-2-2-1 qu'il faut garder) ; et les talismans / EE, rendus 0/0/0/0 par `baseRollPattern`, passaient
  « less than 2/2/2/2 » et polluaient la liste des pièces à vendre. Il manquait aussi trois critères simples de tri du
  rebut : pièce à +0, sans percée, jamais reforgée.
- ✅ **Opérateurs en lettres** (`FilterModal.tsx`) : `BASE_ROLLS_OPS` affiche `at least` (gte), `more than` (gt),
  `exactly` (eq), `at most` (lte), `less than` (lt), même ordre et mêmes valeurs stockées ; le `title` du sélecteur
  dit « Every line of the piece, best first, must be <op> the chosen tier; X = any. » avec l'opérateur choisi.
- ✅ **Inversion** (`filters.ts`) : `BaseRollsFilter` gagne `not: boolean` (false par défaut) ; `matchesFilters` calcule
  le résultat du motif puis rejette la pièce si `match === not`. Case `not` à droite des quatre sélecteurs (le
  `Checkbox` de la modale). `not` + « at least 3/3/3/X » garde une 3-2-2-1 et rejette une 3-3-3-0. Un motif inactif
  (quatre X) reste inactif, `not` coché ou non.
- ✅ **Talismans et EE exclus** : quand le filtre Base rolls est actif, `hasNoRolledSubs(p)` fait échouer la pièce AVANT
  l'inversion. Critère repris de `qualityScore` (`lib/quality.ts`), celui qui rend `quality` null : emplacement
  Talisman ou EE (`slot` `talisman` / `exclusive` côté UI, `ooparts` / `exclusive` côté core) ou aucune sous-stat
  (`subs.length === 0`) ; la troisième condition de `qualityScore` (pas d'étoile) n'est pas reprise, elle ne dit rien
  des lignes tirées. `baseRollPattern` est inchangé (il rend toujours 0/0/0/0 pour ces pièces, le filtre ne le lit
  plus pour elles).
- ✅ **Trois cases** : `FilterState` gagne `enhanceZero` (`enhance === 0`), `breakthroughZero` (`bt === 0`) et
  `notReforged` (`reforge.n === 0`), false par défaut, comptés chacun par `activeFilterCount`, appliqués sur tous les
  onglets. Dans l'en-tête de la modale, à côté de « Exclude equipped gear » : « +0 only », « T0 only », « Not
  reforged ». Les cinq cases de l'en-tête passent d'une rangée flex à une grille de trois colonnes (deux rangées) :
  cinq `Checkbox` en `w-full` sur une rangée de modale `max-w-2xl` auraient coupé les libellés sur deux lignes.
- ✅ **Stockage** : la clé `gs.inv.filters.v3` ne change pas. Les trois champs absents d'une session existante prennent
  false par le recouvrement sur `emptyFilters()` déjà en place ; `readBaseRolls` lit `not === true`, false sinon (forme
  G65 sans `not` comme migration G62).
- ✅ **Tests** : `apps/renderer/test/inventoryBaseRolls.test.ts` (15 → 24 cas) : « less than 2/2/2/2 » ne garde ni
  talisman ni EE, `not` + « at least 2/2/2/2 » non plus (et garde une 2-2-2-1) ; un motif inactif montre encore un
  talisman ; `not` + « at least 3/3/3/X » garde 3-2-2-1, rejette 3-3-3-0 (et « less than 3/3/3/X » jette 3-2-2-1) ;
  « +0 only » rejette +3, « T0 only » rejette bt 1, « Not reforged » rejette `reforge.n` 1 ; `activeFilterCount`
  compte chaque case ; un état v3 stocké sans les trois champs ni `not` se lit avec false ; aller-retour du codec avec
  `not`. Les attentes de migration G62 portent désormais `not: false`.
- ✅ **Docs** : `wiki/Using-the-App.md` (la phrase de G65 passe aux opérateurs en lettres, décrit `not` avec l'exemple
  3/3/3/X, dit que Talisman et EE ne passent jamais un filtre actif ; la liste des filtres cite les trois cases) ;
  `docs/release-notes.md › [Unreleased]` gagne deux lignes (Base rolls en lettres avec not et pièces à gemmes exclues ;
  les trois cases). L'entrée G65 ci-dessous reste telle quelle, c'est un journal. `docs/todo.md` n'avait pas d'item
  correspondant : inchangé.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` (sans erreur, code 0) ; `npm test` → core « Tests 169
  passed (169) », desktop « Tests 219 passed (219) », renderer « Tests 779 passed (779) » ; `npm run lint` → « ✖ 13
  problems (0 errors, 13 warnings) », même compte qu'avant. Pas de rendu réel possible ici (ni `npm run dev` ni
  Electron) : la modale n'a été vérifiée qu'à la lecture.
- ⏳ **Sevih** sur le fixe : Inventaire › Filter › Base rolls `not` + « at least 3/3/3/X » → les 3-2-2-1 restent, les
  3-3-3-x partent, aucun talisman ni EE ; « less than 2/2/2/2 » sans talisman ni EE ; l'en-tête de la modale (deux
  rangées de cases) à juger à l'œil ; « +0 only » + « Not reforged » pour le rebut.

### 🔎 Inventaire : filtre « Base rolls » refait, un opérateur (≥, >, =, ≤, <) appliqué ligne à ligne et X libre, à la place de « at least » / « worse than » (G65) (2026-10-29)
- ✅ **Pourquoi.** Retour du 29/10 sur le fixe : le « worse than 2/2/2/2 » de G62 voulait dire « au moins une ligne sous
  son minimum », si bien qu'une 3/3/1/1 restait visible alors que Sevih y lit « aucune ligne à 2 ou plus ». La règle
  voulue : le motif se lit ligne à ligne, meilleure ligne d'abord, et CHAQUE ligne doit satisfaire `ligne <op> valeur` ;
  « X » sur une ligne = pas de contrainte. Les deux modes de G62 disparaissent.
- ✅ **Filtre** (`screens/inventory/filters.ts`) : `FilterState.baseRolls` devient `{ op: "gte" | "gt" | "eq" | "lte" |
  "lt"; lines: [v, v, v, v] }`, `v` = 0..4 ou `null` (= X), défaut `≥ X/X/X/X` ; inactif (et non compté par
  `activeFilterCount`) tant que les quatre lignes sont X. `matchesFilters` prend `baseRollPattern(p)` (inchangé : paliers
  de base triés décroissants, complétés par 0, reforges ignorées) puis exige, pour chaque ligne, `lines[i] === null ||
  stage <op> lines[i]` (`compareStage`). Pas de cas spécial pour 0 : « < 0 » ne passe jamais, « ≤ 0 » passe à 0
  seulement, et la 4e ligne d'une pièce à trois lignes vaut 0 (« = 3/3/3/1 » l'exclut).
- ✅ **Migration de l'état stocké** : `FILTER_CODEC.deserialize` passe `baseRolls` par `readBaseRolls`, qui lit la
  nouvelle forme (valeur hors 0..4 → X) ou celle de G62 (`atLeast` → `gte`, `below` → `lt`, minimum 0 → X) et retombe
  sur le défaut pour tout le reste ; `serialize` n'écrit que la nouvelle forme. La lecture tolérant l'ancien état, la clé
  `gs.inv.filters.v3` ne change pas.
- ✅ **Modale** (`FilterModal.tsx`) : la section « Base rolls » perd la bascule `BaseRollsModeToggle` ; le « ≥ » fixe
  devant les quatre sélecteurs devient un sélecteur d'opérateur (≥ par défaut, puis >, =, ≤, <, même style que les
  sélecteurs de ligne), et les sélecteurs de ligne proposent « X, 0, 1, 2, 3, 4 » (X par défaut, à la place de « any,
  1..4 »). Aide d'une ligne : « Initial tiers of the sub-stats, best line first, before reforge and enhancement. Every
  line must match; X = any. ». La pastille du compte du bouton Filter est inchangée ; rien d'autre ne bouge.
- ✅ **Tests** : `apps/renderer/test/inventoryBaseRolls.test.ts` repris (15 cas, dont les 3 de `baseRollPattern`
  inchangés) : « < 2-2-2-2 » exclut 3/1/3/1 et 2/2/2/2, garde 1/1/1/1 ; « ≤ 2-2-2-2 » garde 2/2/2/2 ; « ≥ 4-3-X-X »
  garde 4/3/1/0, 4/4/4/4 et 3/4/1/1 (trié 4/3/1/1), exclut 3/3/3/3 et 4/2/2/2 ; « = 3-3-3-1 » garde 3/3/3/1 (aussi
  saisie 1/3/3/3) et exclut 3/3/3/0, 3/3/3/2, 4/3/3/1 ; « > » et les lignes à 0 ; reforge sans effet ; « ≥ X-X-X-X »
  inactif et non compté ; codec aller-retour (X compris), migration des deux modes de G62, écriture de la seule
  nouvelle forme, état sans `baseRolls` → défaut.
- ✅ **Docs** : `wiki/Using-the-App.md` (la phrase de G62 décrit l'opérateur et X, avec les trois exemples) ;
  `docs/release-notes.md › [Unreleased]` gagne « Base rolls filter: pick an operator and use X for a free line » (la
  ligne de G62 est déjà publiée dans `## [1.17.0]`, elle reste). `docs/todo.md` n'avait pas d'item correspondant :
  inchangé.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` (sans erreur) ; `npm test` → core « Tests 169 passed (169) »,
  desktop « Tests 219 passed (219) », renderer « Tests 770 passed (770) » ; `npm run lint` → « ✖ 13 problems (0 errors,
  13 warnings) », inchangé. Pas de rendu réel possible ici (ni `npm run dev` ni Electron) : la modale n'a été vérifiée
  qu'à la lecture.
- ⏳ **Sevih** sur le fixe : Inventaire › Filter › Base rolls « < 2-2-2-2 » → plus aucune pièce avec un 3 ou un 4 ;
  « ≥ 4-3-X-X » → seulement les pièces dont les deux meilleures lignes sont 4 puis au moins 3. Un filtre G62 resté en
  session doit revenir converti (« worse than » → « < », 0 → X).

### 📜 Inventaire : la grille défile seule sous un en-tête fixe, virtualisation effective (hauteur bornée) (G64) (2026-10-29)
- ✅ **Pourquoi.** Relevé du 28/10 sur le fixe (1 575 pièces) : en descendant dans l'Inventaire, l'en-tête (onglets,
  compteurs, `SlotBar`, tri, « Filter ») partait avec la grille, et le défilement ramait. Cause confirmée à la lecture :
  `App.tsx` posait `<main className="min-h-[calc(100vh-60px)]">`, une hauteur MINIMALE ; le `h-full` des écrans qui en
  dépendent (Inventaire, Builds, Presets, Builder) valait donc `auto`, le conteneur de `VirtualGearGrid` (`flex-1 min-h-0
  overflow-y-auto`) s'étirait à toute la liste, c'était la PAGE qui défilait, et le virtualiseur, dont la fenêtre était
  aussi haute que la liste, montait toutes les tuiles. Mesure (nouveau test, géométrie de la grille : tuile 96 px,
  écart 4, overscan 4, 10 colonnes à 1 000 px) : 1 500 pièces → **1 500 tuiles montées** avec un conteneur à la hauteur
  de la liste (l'avant), **100** avec un conteneur borné à 600 px (l'après, fenêtre minimale de l'app), **130** à 900 px
  et **170** à 900 px défilé à la ligne 100 (la fenêtre reste plate).
- ✅ **Hauteur bornée** : `PageBackground` (`design/Shell.tsx`) accepte un `className` ; `App.tsx` en fait une colonne
  flex `h-screen overflow-hidden` (barre du haut, barre de statut quand elle s'affiche, `main`, ligne « Manual
  fallback » sans capture) et `main` devient `min-h-0 flex-1 overflow-hidden` : une hauteur FIXE, le reste de la
  fenêtre, qui suit aussi l'apparition de la barre de statut (pas de `calc(100vh-60px)` magique). La page elle-même ne
  défile plus ; chaque écran défile dans sa zone.
- ✅ **Écran par écran.** **Inventaire** : racine `h-full` désormais résolue ; onglets, `SlotBar`, tri et « Filter »
  restent en place, `parentRef` de `VirtualGearGrid` est la seule zone qui défile ; le panneau de détail (`ItemDetail`,
  `h-full` + son `overflow-y-auto`) est borné lui aussi et défile dans son cadre. **Builds** et **Presets** : leur
  barre du haut (filtres / en-tête) reste en place et la liste défile dans la zone `flex-1 min-h-0 overflow-y-auto`
  qu'elles avaient déjà (prévue pour ça, jamais active). **Builder** : la chaîne de hauteur définie qu'il attendait
  (wrapper `h-full` du montage permanent) fonctionne : barre d'outils et table des résultats (hauteur fixe, déjà
  virtualisée) restent, la bande d'équipement et la colonne de droite (`w-72`) défilent chacune dans leur
  `overflow-y-auto`. **Home** et **Worklist**, sans zone défilante à eux, sont enveloppés dans `App.tsx` d'un
  `<div className="h-full overflow-y-auto">` : ils défilent comme avant, sous la barre du haut. **Settings** et les
  autres modales (`fixed inset-0`) ne bougent pas. Aucun écran ne se retrouve coupé ou sans ascenseur.
- ✅ **Rendus.** Pas de rendus en masse à corriger : les props de `GearTile` (`memo`) sont déjà stables (`onSelect` et
  `toggleExclude` en `useCallback`, `sorted` et `charsByUid` en `useMemo`) ; la lenteur venait des 1 500 tuiles montées.
  `VirtualGearGrid.tsx` exporte sa géométrie (`TILE_SIZE`, `TILE_GAP`, `GRID_OVERSCAN`, `gridColumns`) pour le test, sans
  changer le calcul ; son commentaire dit que la fenêtre exige un parent borné.
- ✅ **Effet visible annexe** : sans capture, la ligne « Manual fallback » sous `main` est maintenant collée en bas de la
  fenêtre au lieu d'être repoussée sous le pli par la hauteur minimale. Rien d'autre ne change (espacements, en-têtes,
  largeurs) ; la position de défilement de la grille ne survit pas au changement d'onglet (remontage, comme avant).
- ✅ **Tests** : nouveau `apps/renderer/test/inventoryGridWindow.test.ts` (4) — le `Virtualizer` de
  `@tanstack/react-virtual` piloté sans DOM (rect et offset fournis à la main, faute de jsdom dans le dépôt) avec la
  géométrie de la grille : 10 colonnes à 1 000 px ; conteneur à la hauteur de la liste → 1 500 tuiles ; borné à 600 px →
  au plus une fenêtre + overscan, moins d'un dixième des pièces ; défilé profond → fenêtre de même taille.
- ✅ **Docs** : `docs/release-notes.md › [Unreleased]`. `wiki/Using-the-App.md` ne décrit pas le défilement, `docs/todo.md`
  n'avait pas d'item correspondant : inchangés.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` (sans erreur) ; `npm test` → core « Tests 169 passed (169) »,
  desktop « Tests 219 passed (219) », renderer « Tests 765 passed (765) » ; `npm run lint` → « ✖ 13 problems (0 errors,
  13 warnings) », inchangé. Pas de rendu réel possible ici (ni `npm run dev` ni Electron) : la mise en page n'a été
  vérifiée qu'à la lecture des classes.
- ⏳ **Sevih** sur le fixe : Inventaire, défiler jusqu'en bas → l'en-tête et « Filter » restent visibles, défilement
  fluide ; chaque autre onglet (Home, Builds, Presets, Builder, Worklist, et Settings) défile encore jusqu'à son bas,
  y compris avec la barre de statut et son log ouverts.

### 🗂️ Données : table `items.json` du contrat synchronisée (facultative) et exposée au renderer, `itemNameOf` (G63) (2026-10-28)
- ✅ **Pourquoi.** outerpedia ajoute au contrat solver une table des objets hors équipement (A83 :
  `{ [id]: { name, icon, itemType, itemSubType, grade, canSell, sellPrice } }`) pour nommer les matériaux, monnaies et
  consommables que l'app ne sait aujourd'hui dire que par leur id. La table n'est pas encore publiée : la synchro devait
  la connaître sans échouer sur son absence, puisqu'elle livre tout ou rien (un artefact manquant refusait la synchro
  entière, au checkout comme en repo, et rendait le cache « incomplet »).
- ✅ **Liste** : `apps/desktop/src/solver-files.json` gagne `items.json` (22 noms) ; nouveau
  `apps/desktop/src/solver-files-optional.json` (`["items.json"]`), le sous-ensemble dont l'absence à la source n'est pas
  une erreur, importé comme la liste par `data-sync.ts` (`OPTIONAL_SOLVER_FILES`) et par `data/sync.mjs`.
- ✅ **Synchro de l'app** (`apps/desktop/src/data-sync.ts`) : en CHECKOUT, un facultatif absent est sauté ; en REPO, un
  **404** seulement le saute — tout autre échec (5xx des deux hôtes, réseau) refuse la synchro comme pour une table
  obligatoire. Les autres tables sont livrées, le message `synced` ajoute « ; items.json not published yet, skipped »
  (c'est la ligne `data sync: synced — …` du log de `main.ts`), une copie déjà en cache reste en place. Publiée, la table
  est livrée et refusée (JSON cassé) comme les autres. `cacheComplete` n'exige plus que les fichiers obligatoires : un
  cache sans `items.json` reste « fresh » à hash égal et sert de repli hors ligne.
- ✅ **`data/sync.mjs`** : un facultatif absent du checkout donne une ligne `optional artifact not published yet: <chemin>;
  skipped` sur stdout et la suite continue ; la PR quotidienne (`data-sync.yml`) ne tombe donc pas sur son absence. Un
  `items.json` présent mais illisible sort en erreur comme avant. Le dépôt n'embarque pas de `data/derived/items.json` :
  il arrivera par la PR de synchro une fois la table publiée.
- ✅ **Renderer** : `GameData.items: ItemsTable` (`ItemInfo` = `{ name: string | null; icon: string | null; itemType;
  itemSubType; grade; canSell; sellPrice }`, `packages/core/src/gamedata.ts`), chargé par `loadGameData`
  (`apps/renderer/src/data.ts`) via `getJSON("/gamedata/items.json")`, `{}` sur 404 — le serveur desktop (`serveStatic`,
  `api-handler.ts`, aussi monté par Vite en dev) répond un 404 propre à un fichier absent, que `getJSON` lit en null, sans
  faire tomber le chargement. Helpers `itemNameOf(game, id)` (nom, ou null : pas de table, id inconnu, objet sans nom) et
  `itemLabel(game, id)` (le nom, ou `item <id>`). Aucun écran ne s'en sert encore (hors périmètre), d'où ni
  release-notes ni changement visuel.
- ✅ **Tests** : `apps/desktop/test/data-sync.test.ts` (110) — REPO : source sans `items.json` (404) → 21 tables livrées,
  message dit, SHA enregistré ; copie en cache gardée sur 404 ; table publiée livrée (22) ; 5xx sur `items.json` → échec,
  cache intact ; `items.json` non JSON → refus ; un AUTRE fichier en 404 → toujours un échec ; cache sans `items.json` →
  « fresh » et repli « offline ». CHECKOUT : sans `items.json` → 21 tables copiées, message dit ; non JSON → refus ; les
  tests « fichier manquant » tournent sur les tables obligatoires. `data/sync.mjs` : sans `items.json` la ligne de log
  sort et le script va jusqu'à la table obligatoire manquante suivante, `data/derived` intact ; `items.json` non JSON →
  sortie non nulle ; liste et sous-liste facultative cohérentes. `apps/desktop/test/server.test.ts` : un fichier absent de
  `/gamedata/` → 404. Nouveau `apps/renderer/test/items.test.ts` (4) : 404 → `items` vide, données chargées ; table
  présente → `game.items` ; `itemNameOf` / `itemLabel` (id nombre ou chaîne, inconnu, sans nom, table vide, pas de
  donnée). Fixture `packages/core/test/parse.test.ts` : `items: {}`.
- ✅ **Docs** : `docs/data-schema.md` + `wiki/Data-Schema.md` (la table, sa forme, son caractère facultatif),
  `docs/reference.md` + `wiki/Engine-Reference.md` (ligne de la table des dérivés, 22 artefacts, l'exception des
  facultatifs), `docs/architecture.md` + `wiki/Architecture.md` (22 artefacts). `docs/todo.md` n'en parlait pas.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` (sans erreur) ; `npm test` → core « Tests 169 passed (169) »,
  desktop « Tests 219 passed (219) », renderer « Tests 761 passed (761) » ; `npm run lint` → « ✖ 13 problems (0 errors,
  13 warnings) », inchangé.
- ⏳ **Sevih** : après la promotion d'A83 côté outerpedia et la PR de synchro mergée, `data/derived/items.json` existe et
  `game.items` n'est plus vide (Settings › Debug ou la console). D'ici là, le log de lancement dit « items.json not
  published yet, skipped ». Une table retirée plus tard de la source laisserait sa dernière copie en cache (choix
  assumé : elle ne sert qu'à nommer).

### 🩹 Capture : la dissolution faite en jeu retire enfin la pièce, pliée d'après la requête journalisée (plugin 0.5.1) (2026-10-28)
- ✅ **Pourquoi.** G44 pliait `/item/dissolve` d'après le `ItemList` de sa RÉPONSE (« les pièces dissoutes, quantité 0 »).
  Une capture réelle du 28/10 dit le contraire : `CWebRES_ItemDissolve` ne porte que `RewardList` (deux `WSRewardData`,
  `RT_TOTAL` et `RT_NORMAL`, avec les matériaux reçus — `WSItemData` à `ItemUID` 0, par ex. l'objet 21102 × 40 — et des
  `AssetList`), aucun `ItemList` au premier niveau ; le client retire les pièces d'après SA requête
  (`CUIItemClear.RequestItemDissolve` → `CPlayer.ItemInventory.RemoveItem(uid)` sur chaque uid envoyé), comme pour la vente.
  Depuis G44, une dissolution faite en jeu ne retirait donc jamais la pièce avant le lobby (le cas que G54 avait prévu).
- ✅ **Plugin 0.5.0 → 0.5.1** (`tools/capture-steam/src/Plugin.cs`, `GearSolverCapture.csproj`) : `/item/dissolve` quitte
  `Journal` (réponse seule) et rejoint les chemins à requête de G59 — postfix sur `CWebRES_ItemDissolve.OnApply` par
  `HookOnApply`, propriété `CWebREQ_ItemDissolve.ItemList` (`List<string>`) copiée dans la file du writer, ligne
  `{ seq, at, path, req: { ItemList }, res }`, la réponse vue pour ce chemin en `res`. Classe, méthode ou champ absent :
  avertissement et chemin non journalisé, comme pour la vente et le verrou. Doc XML du plugin et README (table des hooks,
  table des chemins à requête, ligne `/item/dissolve` retirée de la table des améliorations, table Output) suivent.
- ✅ **Desktop** (`apps/desktop/src/equip-events.ts`) : `/item/dissolve` sort de `ITEM_FIELDS` ; un ensemble
  `REMOVED_BY_REQUEST` (`/item/sell`, `/item/dissolve`) plie chaque uid de `req.ItemList` en entrée simple à quantité 0
  (`soldOf` renommé `removedOf`) — retrait, `clearPresetSlots` compris. `res.ItemList` n'est plus lu. Une ligne
  `/item/dissolve` sans `req` (journal d'un plugin 0.5.0) compte en `skipped`, sans exception : la pièce attend le lobby.
  Les matériaux reçus (`RewardList`) ne sont PAS pliés : ce ne sont pas des pièces, et leurs entrées à `ItemUID` 0 n'ont
  pas d'uid de pile à mettre à jour.
- ✅ **Tests** (`apps/desktop/test/equip-events.test.ts`, 42) : réponse de dissolution façonnée d'après la capture
  (`RewardList` seul) ; dissolution de deux pièces, l'une équipée, l'une dans un preset (4 changements, 0 ignoré, aucun
  matériau ajouté, entrée intacte) ; lignes sans `req`, avec un `res.ItemList` à 0 (non lu) et avec des uids inconnus ou
  nuls (0 changement, 4 ignorés) ; mélange avec équipement, verrou, amélioration et vente ; idempotence avec une
  dissolution dans la suite. Le test G44 « pieces listed at 0 » est retiré (comportement faux), celui des presets et le
  mélange passent à `req`.
- ✅ **Docs** : `docs/reference.md` + `wiki/Engine-Reference.md` (le journal, `/item/dissolve` à requête, plus la phrase
  qui disait le pliage d'après la réponse), `wiki/FAQ.md` (dissolution sous 0.5.1+), `wiki/Capture-Pipeline.md` (ligne
  `equip-events.ndjson`), `docs/release-notes.md › [Unreleased]`. `docs/todo.md` n'en parlait pas.
- ✅ **Vérification.** Sur une copie propre de HEAD avec ces changements : `npm run typecheck` → `> tsc --noEmit` (sans
  erreur) ; `npm test` → core « Tests 169 passed (169) », desktop « Tests 205 passed | 1 skipped (206) », renderer
  « Tests 746 passed | 1 skipped (747) ». Dans l'arbre partagé, seuls les 25 tests de `apps/desktop/test/data-sync.test.ts`
  tombent, sur des fichiers d'un autre lot en cours (`data-sync.ts`, `solver-files.json`, `data/sync.mjs`), aucun des
  miens. `npm run lint` → « ✖ 13 problems (0 errors, 13 warnings) », inchangé. `dotnet build tools/capture-steam -c
  Release` → « 0 Erreur(s) ».
- ⏳ **Sevih, sur le fixe** (après la release et Settings › Setup › Update plugin jeu fermé) : désassembler une pièce en
  jeu → elle quitte l'Inventaire de GS dans les 5 s ; `equip-events.ndjson` porte la ligne `/item/dissolve` avec `req`.

### 🔎 Inventaire : filtre sur les paliers de base des sous-stats, motif trié, « au moins » ou « moins bien que » (G62) (2026-10-28)
- ✅ **Quoi.** La modale Filter de l'Inventaire gagne une section **Base rolls** : quatre sélecteurs 0–4 (0 = any) lus
  « ≥ a / b / c / d », une bascule **at least** / **worse than** et une ligne d'aide. Les paliers de base des lignes de
  sous-stats de la pièce sont triés décroissant et complétés par 0 jusqu'à 4 lignes ; `atLeast` garde les pièces dont
  chaque ligne atteint son minimum, `below` garde les autres (au moins une ligne sous son minimum) : le mode « rebut »
  à vendre. Un motif tout à 0 est inactif dans les deux modes ; actif, il compte dans la pastille du bouton Filter.
- ✅ **Pourquoi.** Trier son stock par qualité de drop (le palier tiré au drop, pas les reforges ni l'enhance) pour
  repérer les bonnes pièces ou la ferraille, avec la même notion de « 3/3/3/1 » que la règle Transistone (G56).
- ✅ **Comment.** Pas de champ ajouté au core : dans `parse.ts`, `ticks = Level + 1` et `reforgeTicks = Level −
  BaseLevel`, donc `ticks − reforgeTicks = BaseLevel + 1`, exactement le palier de ligne 1..4 de `lib/solver/reroll.ts`
  (stage 4 = `BaseLevel` 3) ; l'enhance n'ajoute rien aux `Level` des sous-stats. `baseStage` y est exporté (paramètre
  élargi à `Pick<RolledStat, "ticks" | "reforgeTicks">`) et `screens/inventory/filters.ts` l'appelle sur
  `UiSubstat.lv` / `reforges` via `baseRollPattern(p)`. `FilterState.baseRolls = { min, mode }`, défaut
  `[0,0,0,0]` / `atLeast` ; champ additif : `FILTER_CODEC.deserialize` pose déjà les valeurs stockées sur
  `emptyFilters()`, un état v3 sans `baseRolls` lit le défaut, la clé reste `gs.inv.filters.v3`. Talisman et EE (gemmes,
  pas de sous-stats) valent 0/0/0/0 : exclus par « at least » dès qu'un minimum est posé, gardés par « worse than » ;
  l'aide de la modale le dit. `FilterModal.tsx` : `BaseRollsModeToggle` (même rendu que le OR / AND) et
  `BaseRollsInputs`, section placée entre Secondary Stat et Set Effect, aucun autre changement visuel.
- ✅ **Tests.** `apps/renderer/test/inventoryBaseRolls.test.ts` part du fil (`RawItem.SubOptionList` → `parseGearPiece`
  → `toUiPiece`) : 1/3/3/3 sur le fil = 3/3/3/1 ; pièce à 3 lignes = 4e ligne 0, sans sous-stats = 0/0/0/0 ; base 2
  reforgée à 4 reste 2 ; 3/3/3/1 passe « ≥ 3/3/3/0 », 3/3/2/2 non, `below` l'inverse ; une reforge ne fait pas passer
  une ligne au-dessus du motif ; motif à 0 inactif et non compté ; codec aller-retour et lecture d'un état sans
  `baseRolls`. Vérifié sur une copie de HEAD + les fichiers du lot (le working tree portait le travail en cours d'un
  autre lot côté desktop) : `npm run typecheck` sort en code 0 ; `npm test` → core « Tests  169 passed (169) »,
  desktop « Tests  204 passed | 1 skipped (205) », renderer « Tests  756 passed | 1 skipped (757) » ; `npm run lint`
  → « ✖ 13 problems (0 errors, 13 warnings) », inchangé.
- ✅ **Docs.** `wiki/Using-the-App.md` (filtres de l'Inventaire), `docs/release-notes.md › [Unreleased]`.
- ⏳ **Sevih** : Inventaire › Filter › Base rolls « worse than 3/3/3/0 » → seules les pièces dont une des trois
  meilleures lignes est sous le palier 3 restent ; basculer « at least » → le complément.

### 🩹 Dépendances : `npm audit fix` des 12 vulnérabilités restantes, `package-lock.json` seul (2026-10-27)
- ✅ **Pourquoi.** Après la montée d'electron-builder (25/10), `npm audit` disait encore 12 vulnérabilités (1 modérée,
  11 hautes, 0 critique), toutes « fix available » sans majeure : `axios` (1.0.0 – 1.19.0), `follow-redirects`
  (1.16.0), `joi` (18.0.0 – 18.2.8) via `wait-on` à la racine ; `vite` (≤ 6.4.3), `postcss` (≤ 8.5.22), `nanoid`
  (≤ 3.3.17), `source-map-js` (1.0.0 – 1.2.1) côté renderer ; `browserslist` (≤ 4.28.6) et `baseline-browser-mapping`
  (modérée, < 2.11.0) via `eslint-plugin-react-hooks` → `@babel/core` ; `js-yaml` (4.0.0 – 4.3.1, embarqué par
  `electron-updater`) ; `brace-expansion` (3.0.0 – 5.0.11, via `minimatch`) ; `undici` (7.0.0 – 7.30.0, `electron` →
  `@electron/get`). `launch-editor`, cité le 25/10, n'est pas dans le lock : l'audit ne le listait pas.
- ✅ **Comment.** `npm audit fix` sans `--force` → « found 0 vulnerabilities ». `git diff --stat` : `package-lock.json`
  seul (+57 / −57) ; aucun `package.json` touché, pas de `pnpm-lock.yaml`. `electron` reste 44.9.3, `electron-builder`
  26.15.3, `electron-updater` 6.8.9.
- ✅ **Ce qui a bougé dans le lock** (script sur `git show HEAD:package-lock.json` et le lock du working tree, entrée
  par entrée de `packages`) : 587 entrées avant et après, aucune ajoutée ni retirée, 16 changées, toutes en version
  (et `resolved` / `integrity` / plages de dépendances) — `axios` 1.18.1 → 1.21.0, `follow-redirects` 1.16.0 →
  1.16.2, `joi` 18.2.3 → 18.3.0, `vite` 6.4.3 → 6.4.5, `postcss` 8.5.15 → 8.5.32, `nanoid` 3.3.15 → 3.3.20,
  `source-map-js` 1.2.1 → 1.2.2, `browserslist` 4.28.4 → 4.29.5, `baseline-browser-mapping` 2.10.38 → 2.11.33,
  `js-yaml` 4.2.0 → 4.3.2, `brace-expansion` 5.0.6 → 5.0.12, `undici` 7.28.0 → 7.30.1, plus les quatre dépendances
  de `browserslist` montées avec lui : `caniuse-lite` 1.0.30001799 → 1.0.30001819, `electron-to-chromium` 1.5.377 →
  1.5.465, `node-releases` 2.0.48 → 2.0.60, `update-browserslist-db` 1.2.3 → 1.3.4. Le reste du lock est identique à
  l'octet (la liste étant courte, pas besoin du contrôle par atteignabilité). `npm ls --all` sort en code 0 : le
  « invalid » sur `vitest` noté le 25/10 (liens `.pnpm/` du 23/10) a disparu avec la réinstallation.
- ✅ **Renderer.** `apps/renderer/dist` construit avant le fix (vite 6.4.3) puis après (« vite v6.4.5 building for
  production ») : 29 fichiers dont 18 assets, 961 347 octets des deux côtés, mêmes noms hashés fichier par fichier,
  donc un contenu identique (écart 0 %, sous les 5 % demandés).
- ✅ **Pack.** `npm run desktop:build` sans erreur, puis `npm run pack -w @gear-solver/desktop -- --win` →
  « packaging platform=win32 arch=x64 electron=44.9.3 appOutDir=release/win-unpacked », sans erreur. Dans
  `release/win-unpacked/resources/app.asar` (`asar list` lancé depuis `apps/desktop/release/`, `extract-file` vers un
  dossier temporaire hors du dépôt) : les mêmes 16 modules d'exécution, `node_modules/js-yaml/package.json` à
  « 4.3.2 », `electron-updater` 6.8.9 et `builder-util-runtime` 9.7.0 inchangés ; `js-yaml` est le seul des 16
  paquets changés présents dans l'asar. Pas d'installeur de banc.
- ✅ **Vérification.** `npm run typecheck` → dernière ligne « > tsc --noEmit » (renderer), code 0 ; `npm test` →
  « Tests 169 passed (169) » (core), « Tests 205 passed (205) » (desktop), « Tests 747 passed (747) » (renderer) ;
  `npm run lint` → « ✖ 13 problems (0 errors, 13 warnings) », inchangé.
- ✅ **Laissé.** Rien côté audit (0 restante). `npm install` avertit toujours qu'`electron-winstaller` et `esbuild` ont
  des scripts d'installation hors `allowScripts`. `docs/todo.md` ne cite pas l'audit : inchangé.
- ⏳ **Sevih** : à la prochaine release, rien de particulier à contrôler, l'updater embarqué ne change pas de version
  (`electron-updater` 6.8.9) — seul `js-yaml` bouge dans l'asar.

### 🏷️ Vente et verrou faits en jeu suivis en direct : la requête du client journalisée pour `item/sell` et `item/lock` (plugin 0.5.0) (2026-10-27)
- ✅ **Pourquoi.** Piste laissée par G44 et demandée le 27/10 : une pièce vendue en jeu restait dans le snapshot (et
  dans l'Inventaire) jusqu'au lobby, un verrou posé en jeu n'apparaissait pas. Les réponses ne disent rien des pièces :
  `CWebRES_ItemSell` ne rend que l'or (`Asset_0`) et le client retire les pièces d'après SA requête
  (`CWebREQ_ItemSell.ItemList`, uids en chaînes, cf. `CUIItemClear`, `CUIItemSmelting`, `CUICraftingResult`) ;
  `CWebRES_ItemLock.OnApply` lit `ItemUID` et `IsLock` (bool) de `CWebREQ_ItemLock`.
- ✅ **Pourquoi pas la voie requête de `Log2InternalWeb`.** Vérifié dans `CWebManager` : l'appel
  `Log2InternalWeb(text, cmdResource, request: true)` n'existe que dans la voie coroutine
  (`CRequestCommand<TReq, TRes>`, chemin écrit `item/sell` sans `/`) ; la vente et le verrou passent tous deux par
  `CNetwork.Request(req, callback)` → `CHttpGame.Request` → `CWebManager.CRequestCommand<T>(…, Action)`, qui sérialise
  et chiffre la requête sans jamais la journaliser. Le hook ne l'aurait jamais vue. Décision de Sevih (27/10) : un
  postfix Harmony sur `CWebRES_ItemSell.OnApply` et `CWebRES_ItemLock.OnApply`, appelés sur les deux voies,
  seulement en cas de succès et juste après la réponse passée par `Log2InternalWeb` (ordre vérifié dans les deux
  voies).
- ✅ **Plugin** (`tools/capture-steam/src/Plugin.cs`, 0.4.0 → 0.5.0 dans `Plugin.Version` et le `.csproj`).
  `Hooks.HookOnApply` résout par nom `CWebRES_ItemSell` / `CWebRES_ItemLock`, leur `OnApply` déclaré, et les
  propriétés de requête (`CWebREQ_ItemSell.ItemList`, `CWebREQ_ItemLock.ItemUID` / `IsLock`) ; une pièce manquante
  ou un `Patch` qui échoue → `LogWarning`, le chemin n'est pas suivi (aucune ligne), rien d'autre ne change. Les
  postfixes (`AfterItemSellApply`, `AfterItemLockApply`, `object _req`) ne font que copier les champs typés
  (`List<string>` recopiée ; uid + bool) et les mettre dans la file du writer (`Sink.CaptureRequest`). Nouvel ensemble
  `Sink.WithRequest` (rempli par `TrackRequest` pour chaque hook posé), hors de `Journal` : la réponse d'un de ces
  chemins n'écrit rien, elle est gardée dans `LastRes` (writer seulement) et prise par la ligne suivante du chemin ;
  la ligne `{ seq, at, path, req, res }` (`path` `/item/sell` ou `/item/lock`, `res` = cette réponse ou `{}`) est
  écrite par le hook `OnApply`, via `AppendJournal(path, res, req)` (paramètre `req` optionnel, clé placée avant
  `res`). Une ligne par geste, jamais une ligne `res` seule ; une requête refusée par le serveur (pas d'`OnApply`)
  n'écrit rien. Les chemins de `Journal` gardent `{ seq, at, path, res }`. Effet de bord : les réponses de ces deux
  chemins ne vont plus dans `_unknown/` (`KeepUnknown`), puisqu'ils sont suivis. README du plugin : le hook dans la
  table des postfixes, une table des chemins avec la colonne « Request journaled », le pourquoi de la voie requête,
  les deux formes de ligne dans « Output ».
- ✅ **Desktop** (`apps/desktop/src/equip-events.ts`). `EquipEvent.req?: unknown` ; `reqOf` (objet ou null) ;
  `soldOf` change chaque uid de `req.ItemList` en entrée simple à quantité 0, qui suit le chemin des entrées simples
  (retirée d'`ItemList`, uid noté dans `removed`, donc `clearPresetSlots` compris, comme une dissolution) ;
  `/item/lock` met `IsLock` de l'entrée `req.ItemUID` à 1 ou 0 d'après `req.IsLock` (le snapshot porte un entier,
  la requête un bool). Uid absent, `IsLock` non booléen, ligne sans `req` ou `ItemList` vide → `skipped`, jamais
  d'exception. Rejeu idempotent (état absolu ; un uid déjà vendu est absent donc ignoré).
- ✅ **Renderer, vérifié sans changement.** L'Inventaire montre le cadenas d'après `piece.locked`
  (`screens/inventory/VirtualGearGrid.tsx`, et `design/ResultGearDetail.tsx`), lu de `IsLock === 1` par core
  `parse.ts` ; la Worklist dit « gone » une pièce absente de l'inventaire (`changeState`, G54) : une pièce vendue y
  passe telle quelle.
- ✅ **Docs.** `docs/reference.md` et `wiki/Engine-Reference.md` (les deux formes de ligne et le pli vente /
  verrou), `wiki/Capture-Pipeline.md` (la ligne `equip-events.ndjson` de la table des fichiers), `wiki/FAQ.md`,
  `docs/release-notes.md › [Unreleased]`. `docs/todo.md` inchangé : il n'a pas d'item « Suivi en direct — restes »
  ni d'item qui nomme `item/sell` / `item/lock` (l'item Equip / Unequip ne parle que des déplacements).
- ✅ **Tests.** `equip-events.test.ts`, bloc « sale and lock » (6 cas) : vente de deux pièces dont une équipée et une
  dans un preset (pièces retirées, slots des presets à 0) ; vente d'un uid inconnu au milieu d'uids valides ;
  verrou puis déverrou ; lignes sans `req` ou à `req` inutilisable (6 `skipped`, snapshot intact) ; mélange avec
  equip, enchant (G44), dissolve et un equip d'une pièce déjà vendue (G54) ; idempotence. `npm run typecheck` →
  dernière ligne « > tsc --noEmit » (renderer), code 0 ; `npm test` → « Tests 169 passed (169) » (core),
  « Tests 205 passed (205) » (desktop), « Tests 747 passed (747) » (renderer) ; `npm run lint` → « ✖ 13 problems
  (0 errors, 13 warnings) », inchangé. `dotnet build tools/capture-steam -c Release` (SDK 8.0 présent sur le
  portable, jeu + BepInEx installés) → « 0 Erreur(s) », DLL 0.5.0 dans `dist/` (ignoré par git).
- ✅ **Build du plugin.** Il n'y a pas de workflow CI `capture-plugin` (`.github/workflows` : `ci.yml`,
  `data-sync.yml`, `publish-wiki.yml`) : le plugin se construit à la main (`npm run capture-steam:build`), et
  `apps/desktop/scripts/fetch-binaries.mjs` le reconstruit à chaque `npm run release` en vérifiant que
  `Plugin.Version`, le `.csproj` et la DLL disent la même version.
- ✅ **Laissé.** `item/sell/consumable` (consommables seulement), le Custom Gear, l'or rendu par la vente.
- ⏳ **Sevih, sur le fixe** (après la release et Settings › Setup › Update plugin, jeu fermé) : vendre en jeu une
  pièce en file → ligne « piece gone » dans la Worklist dans les 5 s, la pièce quitte l'Inventaire ; verrouiller une
  pièce → cadenas dans l'Inventaire ; `equip-events.ndjson` du dossier de capture porte des lignes avec `req` pour
  ces deux chemins ; `LogOutput.log` dit « hooked CWebRES_ItemSell.OnApply » et « hooked CWebRES_ItemLock.OnApply ».

### 🔒 Presets du jeu : rang de priorité et verrou, pièces des presets mieux classés ou verrouillés hors du pool (2026-10-27)
- ✅ **Pourquoi.** « Optimize preset → » (G47) envoyait au Builder des filtres, mais le Builder puisait dans tout
  l'inventaire comme si aucun preset n'existait : une pièce du preset n°1 pouvait partir dans la build proposée pour le
  n°3. Règle demandée (27/10), celle des persos : le preset de rang 1 peut tout prendre, le rang 3 pas les pièces des
  rangs 1 et 2 ; plus un verrou par preset, dont les pièces ne sont jamais proposées.
- ✅ **Rang.** Le modèle de rang de `heroPriority.ts` est extrait tel quel dans `lib/storage/rankPriority.ts`
  (`rankOrder`, `isLowerPriority`, `reorderRank`, `moveRankBefore`, `fillUnrankedByOrder`, `loadSeen` / `persistSeen`
  paramétrés par clé de stockage) ; `heroPriority.ts` le réexporte et garde ses clés (`gs.priority.rank` / `.seen`),
  les 21 tests de `heroPriority.test.ts` passent sans retouche. `lib/storage/presetPriority.ts` : `gs.presets.rank`
  (clé = `num` en chaîne), `gs.presets.seen`, `gs.presets.locked` (`number[]`), `toggleLocked`. Un preset jamais vu
  reçoit un rang sous les classés dans l'ordre en jeu (`presetGameOrder` = `comparePresets`, favoris, `sortOrder`
  décroissant, num ; Master League après), à l'ouverture de l'onglet Presets, comme Builds remplit les persos par CP ;
  un rang effacé le reste. Rang et verrous appartiennent à `App` (`usePersistedState`), donc vivants pour le Builder
  resté monté.
- ✅ **Solveur.** `lib/presets/presetHolds.ts` : `presetHolds(inventory, rank, locked)` donne la table uid → presets
  tenants (EE et slots vides exclus, comme `presetSignature` ; `isEmptyUid` exporté de `presetRows.ts`) avec rangs et
  verrous ; `presetBlockedUids(holds, targetNum)` calcule une fois par solve les pièces retirées : (a) preset verrouillé
  qui n'est pas le preset visé, (b) preset visé Q et tenant P non strictement moins prioritaire (`isLowerPriority`,
  P ≠ Q) ; une pièce à plusieurs tenants sort dès qu'un tenant la bloque (= le plus contraignant gagne). `SolveRequest`
  / `EstimateRequestMsg` / `SolveArgs` portent `presetHolds` et `targetPresetNum` (orchestrateur, solve et estimation) ;
  `allow()` teste l'ensemble juste après `excludedPieceUids`, avant le propriétaire effectif : les règles existantes
  (`equippedScope`, rang des héros, `excludedHeroes`, `worklistClaims`) sont inchangées et se cumulent. Un verrou vaut
  aussi pour les pièces que porte le héros résolu (« quel que soit le perso »). Le pool de gemmes suit (`presetBlocked`
  dans `buildGemPool`) : le Talisman d'un preset bloqué garde ses gemmes, pour que l'invariant « éligibilité des gemmes
  = celle des pièces » de `reference.md` §2.7 reste vrai.
- ✅ **Preset visé.** `onOptimizePreset` reçoit le `num` du preset (`App` → `builderPatch.presetNum` →
  `initialPatch.presetNum`) ; `BuilderScreen` le tient lié au héros ouvert (`targetPreset`) et le perd au changement de
  perso ; « Optimize → » (héros associé), Builds, Home et la Worklist n'en posent pas, donc seuls les verrous comptent.
  Ligne de statut sous la note G47 dans la Library (`RightSidebar.presetStatus`) : « Optimizing preset ‹nom› (rank N) —
  pieces of higher-ranked and locked presets excluded » (« unranked » sans rang).
- ✅ **Interface.** Onglet Presets : sur chaque carte le même éditeur de rang que Builds (`RankInput` et la poignée ⠿
  sortis de `BuildsScreen.tsx` dans `design/RankInput.tsx`, titre en paramètre, rendu identique), drag-to-reorder en
  tri « Priority » (nouveau, à côté de « In-game » et « Class » : `arrangePresets(…, presetRank)`, rang 1 d'abord, non
  classés à la fin dans l'ordre du jeu), bouton 🔓 Lock / 🔒 Locked à droite de l'en-tête avec un titre explicite, carte
  verrouillée à liseré ambre. Résultats du Builder : une pièce tenue par un autre preset que le preset visé dit « from
  preset ‹nom› » sous l'en-tête de sa gear card (`presetHoldersOf`, mieux classé d'abord ; `BottomGearBand.presetsOf` →
  `ResultItemDetail.fromPresets`), compact compris, comme le portrait dit le perso d'où vient la pièce.
- ✅ **Tests.** `presetHolds.test.ts` (17) : table (EE et vides exclus, pièce à deux presets), verrouillé hors de tout
  pool sauf le sien, visé rang 3 sans les rangs 1 et 2 mais avec le 4 et les non classés, rang 1 prend tout, visé non
  classé ne prend rien d'un autre, sans preset visé seuls les verrous, pièce tenue par deux presets, `presetHoldersOf`,
  rang par défaut = ordre en jeu ; `allow()` par `precomputeContext` sur le vrai contrat (sans visé / visé / verrouillé
  visé, requête sans table, cumul avec `excludedPieceUids` et `worklistClaims` sous « lower », pièce portée par le
  héros) ; pool de gemmes. `presets.test.ts` : tri « priority » (+1).
- ✅ **Docs.** `reference.md` + `wiki/Engine-Reference.md` (§1.6 règles de pool et presets du jeu, §2.7, tables de tests,
  carte des modules), `solver.md` + `wiki/Solver.md` (Equipped items), `wiki/Using-the-App.md` (Rank and lock),
  `release-notes.md › [Unreleased]`. `wiki/FAQ.md` ne parle des presets que pour la confidentialité : inchangée.
  `docs/todo.md` n'a pas d'item « Presets du jeu — restes » (relu le 27/10) : inchangé.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` sans erreur (les trois workspaces) ; `npm test` →
  « Tests 169 passed (169) » (core), « Tests 199 passed (199) » (desktop), « Tests 747 passed (747) » (renderer) ;
  `npm run lint` → « ✖ 13 problems (0 errors, 13 warnings) », inchangé (l'avertissement `set-state-in-effect` de
  `RankInput` a suivi le composant de `BuildsScreen.tsx` à `design/RankInput.tsx`).
- ✅ **Laissé.** La sauvegarde (`lib/storage/transfer.ts`) ne porte ni `gs.presets.*` ni, déjà, `gs.priority.*` ; les
  gemmes d'EE proposées dans l'onglet Presets (`bestEeGemsFor`) ignorent rangs et verrous (l'EE n'est jamais dans un
  preset) ; les rangs d'un preset supprimé en jeu restent stockés, comme ceux d'un perso disparu.
- ⏳ **Sevih, sur le fixe** : classer deux presets (rang 1 et 2), verrouiller un troisième, « Optimize preset → » sur le
  rang 2 → aucune pièce du rang 1 ni du verrouillé dans les résultats, les pièces du rang 3 et des non classés y sont
  et sont dites « from preset … » ; « Optimize preset → » sur le rang 1 → tout sauf le verrouillé ; un solve de perso
  lancé depuis Builds → seul le verrouillé est écarté. Vérifier aussi la ligne de statut de la Library et sa
  disparition au changement de perso.

### 📦 Outillage de release : electron-builder 25.1.8 → 26.15.3 et electron-updater aligné, installeur de banc 1.15.0-g55 (2026-10-25)
- ✅ **Pourquoi.** `npm audit` (23/10) : 27 vulnérabilités (1 modérée, 25 hautes, 1 critique `tar`), dont l'essentiel
  dans l'arbre d'`electron-builder` 25 (`app-builder-lib`, `builder-util*`, `dmg-builder`, `electron-publish`,
  `@electron/rebuild`, `node-gyp`, `cacache`, `make-fetch-happen`, `tar`, `@xmldom/xmldom`…) ;
  `npm audit fix --dry-run` ne proposait que la 26.15.3, majeure.
- ✅ **Versions.** `apps/desktop/package.json` : `electron-builder` `^26.15.3` ; `electron-updater` `^6.8.9` aux deux
  endroits (dépendance et `build.extraMetadata.dependencies`). 6.8.9 est l'electron-updater publié avec la 26.15.0
  (même minute, le 05/06), la dernière sur `builder-util-runtime` 9.7.0, celui qu'épingle `app-builder-lib` 26.15.3
  (les 26.15.1 à 26.15.3 n'ont pas republié l'updater ; la 6.8.10 suit la 26.17.0). Le lock résolvait **déjà**
  `electron-updater` 6.8.9 sous l'ancien `^6.3.9` : la 1.15.0 installée embarque la même version, seul le plancher
  du range monte. `npm install electron-builder@26.15.3 -D -w @gear-solver/desktop` : `package.json` sans autre
  retouche, `package-lock.json` +1 022 / −1 957 (67 paquets ajoutés, 140 retirés, 37 changés, dont `7zip-bin` et
  `app-builder-bin` sortis). Contrôle du périmètre par atteignabilité dans le lock : les paquets atteignables depuis
  les workspaces **sans passer par `electron-builder` ni `electron-updater`** sont les mêmes 344, aux mêmes versions,
  avant et après ; le lock ne bouge que dans l'arbre de ces deux paquets.
- ✅ **Notes de version lues** (releases GitHub 26.0.0-alpha.0 → 26.0.20, puis le `CHANGELOG.md` d'`app-builder-lib`
  26.1.0 → 26.15.3). Aucune clé de notre `build` n'est retirée ni renommée : pas de signature (`win.signtoolOptions`
  sans objet), pas de `desktop` (Linux), pas d'`electronDist`, `win.target nsis` x64 seul (l'installeur universel ne
  nous concerne pas), `electronVersion` épinglé `44.9.3` (la 26.12.1 refuse une version non épinglée), `npmRebuild` /
  `nodeGypRebuild` / `buildDependenciesFromSource` toujours lus (« skipped dependencies rebuild reason=npmRebuild is
  set to false »). Ce qui touche l'auto-update : blockmap réécrit en TypeScript (26.14.0, plus d'`app-builder-bin`),
  ordre des fichiers de `latest.yml` rendu déterministe (26.12.0) ; détection des workspaces npm et collecte des
  `node_modules` par `npm list` (« detected workspace root for project using lock file »). La config est validée par
  le nouveau validateur ajv de la 26.13.1 sans avertissement.
- ✅ **Pack et hook.** `npm run desktop:build` puis `npm run pack -w @gear-solver/desktop -- --win` (le `--dir` seul
  viserait Linux) → « packaging platform=win32 arch=x64 electron=44.9.3 appOutDir=release/win-unpacked », sans
  erreur. `before-pack.mjs` n'a pas eu à changer : la 26 résout toujours `beforePack` en fonction et émet le contexte
  `{ packager, … }`, `PlatformPackager` garde `get config()` et `readonly info: Packager` (`projectDir`). Comme
  `resources/prod-cert/` n'existe plus, le hook ne dit rien ; avec un `resources/prod-cert/` vide créé le temps d'un
  second pack, puis retiré, l'avertissement « [pack] …/apps/desktop/resources/prod-cert is left over from an older
  build — ignored, NOT packaged… » s'affiche avant « packaging », chemin tiré de `context.packager.info.projectDir`.
- ✅ **Installeur non publié.** `npm run fetch-binaries -w @gear-solver/desktop` → « [ok] capture-steam plugin 0.4.0
  (16 896 bytes) » ; `npm run dist -w @gear-solver/desktop -- --win --publish never
  '-c.artifactName=${productName} Setup ${version}-g55.${ext}'` → « building target=nsis … oneClick=false
  perMachine=false », puis « building block map » → `apps/desktop/release/Outerpedia Gear Solver Setup 1.15.0-g55.exe`,
  copié dans `~/Echanges-Claude/` (112 824 374 octets, contre 115 875 200 pour la 1.15.0 ; SHA-256
  `605ea5688ae222f2fdbfc8f50dd2fa10fe0ef3d107c1d4999b50a92f49209a4a`). `latest.yml` et `builder-debug.yml` de
  `release/` remis comme après la 1.15.0 (non suivis). Le `latest.yml` produit garde la forme lue par l'app
  (`files[].url` à tirets, `sha512`, `size`, `path`, `releaseDate`).
- ✅ **Comparaison avec le `win-unpacked` de la 1.15.0.** Même liste de fichiers (`resources/app.asar`,
  `app-update.yml`, `elevate.exe`, `capture-steam/GearSolverCapture.dll` 16 896 octets, les 21 tables de
  `data/derived`, `renderer/dist`), aux assets hashés du renderer près (17 → 18, le code de G53/G54/G56) ;
  `app-update.yml` identique à l'octet (`updaterCacheDirName: '@gear-solverdesktop-updater'` compris). Dans
  `app.asar`, les 16 modules d'exécution sont aux mêmes versions (`electron-updater` 6.8.9, `builder-util-runtime`
  9.7.0, `js-yaml` 4.2.0, `semver` 7.7.4…) ; seuls `builder-util-runtime` et `semver` remontent de
  `node_modules/electron-updater/node_modules/` à `node_modules/` (l'ancien `builder-util-runtime` 9.2.10 d'electron-builder
  25 occupait la place). Les 3 Mo de moins viennent de l'archive interne `$PLUGINSDIR/app-64.7z` (115 039 206 →
  111 986 289 octets pour 391 979 254 octets décompressés, contre 391 995 347) : même méthode LZMA2:20 BCJ2, refaite
  par le 7-Zip du toolset 26 au lieu de `7zip-bin` ; `7z t` sur l'archive extraite → « Everything is Ok »
  (125 fichiers). `builder-debug.yml` : motifs d'exclusion par défaut élargis (`pnpm-lock.yaml`, `bun.lock`, `*.obj`)
  et section de composants de désinstallation NSIS, rien qui nous concerne.
- ✅ **`scripts/release.mjs` tient, rien de changé.** Nom de l'exe : motif par défaut de la cible NSIS toujours
  `${productName} Setup ${version}${archSuffix}.${ext}` (sans suffixe en x64 seul), donc `hashInstaller` (« setup »
  + `.exe` + version) le trouve ; nom de l'asset GitHub toujours les espaces changés en tirets
  (`computeSafeArtifactNameIfNeeded`), ce que suppose `integrityNote` ; `electron-publish` 26 crée toujours un
  **draft** par défaut (promu à l'étape 8) avec le tag `v` + version, et lit `GH_TOKEN` / `GITHUB_TOKEN` ; le script
  ne lit ni `latest.yml` ni le blockmap, qu'electron-builder téléverse lui-même.
- ✅ **`npm audit` après : 12 vulnérabilités (1 modérée, 11 hautes, 0 critique)**, contre 27. Il ne reste dans l'arbre
  d'electron-builder que des paquets partagés ou corrigibles sans majeure : `js-yaml` 4.2.0 (haute,
  `app-builder-lib` / `builder-util` / `dmg-builder` et `electron-updater`, donc embarqué) et `brace-expansion` 5.0.6
  (haute, via le `minimatch` 10.2.5 partagé avec `eslint` et `@typescript-eslint`). Le reste ne vient pas de lui :
  `axios`, `follow-redirects`, `joi` (`wait-on` 8.0.5, racine) ; `vite` 6.4.3 (et ses `launch-editor`), `postcss`,
  `nanoid`, `source-map-js` (renderer, `vite` / `@tailwindcss/vite`) ; `browserslist` et `baseline-browser-mapping`
  (modérée) (`eslint-plugin-react-hooks` → `@babel/core`) ; `undici` 7.28.0 (`electron` → `@electron/get`). Tous
  « fix available via `npm audit fix` », hors périmètre de ce lot.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` sans erreur (les trois workspaces) ; `npm test` →
  « Tests 169 passed (169) » (core), « Tests 199 passed (199) » (desktop), « Tests 729 passed (729) » (renderer) ;
  `npm run lint` → « ✖ 13 problems (0 errors, 13 warnings) », inchangé. `git diff --stat` : `apps/desktop/package.json`,
  `package-lock.json` (et ce journal). Le `package.json` racine, écrasé en cours de session par un `asar extract-file`
  lancé à la racine, a été restauré depuis HEAD avant ces vérifications (le build et le dist avaient tourné avant).
- ✅ **Laissé.** L'`npm audit fix` des 12 restantes (lock seul, sans majeure, mais il touche `wait-on`, `vite`,
  `eslint`, `electron`) ; la montée au-delà de la 26.15.3 (26.18.0 publiée le 20/10). `npm install` avertit que
  `electron-winstaller` (cible Squirrel, inutilisée), `esbuild` et `globals` ont des scripts d'installation hors
  `allowScripts`. Le `node_modules` local mêle des liens `.pnpm/` du 23/10 au soir (`wait-on`,
  `eslint-plugin-react-hooks`…), d'où un « invalid » de `npm ls` sur `vitest` ; sans effet sur le lock ni la CI.
- ⏳ **Sevih, sur le fixe** : installer `Outerpedia Gear Solver Setup 1.15.0-g55.exe` (`~/Echanges-Claude/`) par-dessus
  la 1.15.0 → lancement, capture au lobby, un solve, « Equip this build » jeu fermé. Puis, à la prochaine release,
  l'auto-update depuis la 1.15.0 est **le** contrôle : l'updater installé ne change pas (6.8.9 des deux côtés), mais
  `latest.yml` et le blockmap sont désormais produits par la 26 (blockmap en TypeScript) et doivent rester lisibles par
  l'app installée, téléchargement différentiel compris.

### 💎 Potentiel de reroll Transistone dans la projection du Builder et la qualité atteignable, règle du client (2026-10-25)
- ✅ **Pourquoi.** Le patch du 20/10 permet de monter une ligne de sous-stat jusqu'au palier 4 par Transistone ; rien
  n'en était modélisé (la projection ne couvrait que la main et les reforges, la qualité ne comptait que les ticks
  présents). Les deux questions du TODO (une ligne, une fois ? toutes les étoiles ?) sont tranchées par le client.
- ✅ **La règle du client** (écrite, fichier et ligne, en tête de `apps/renderer/src/lib/solver/reroll.ts`). Le
  Transistone est un **reroll aléatoire**, pas une montée garantie : Individual retire la ligne choisie et verrouille
  les autres, Total retire les quatre et lève le verrou ; le joueur garde ou jette le résultat
  (`item/subOptionChange`, `IsSelected`), sans compteur de passes (seuls le Transistone et l'or sont vérifiés). L'onglet
  s'ouvre sur 5★ Rare/Unique et 6★ Magic/Rare/Unique à exactement 4 lignes (`CItem.GetIsEnableOptionChange`), mais
  seules les lignes 24 et 48 de `ItemOptionChangeTemplet` (6★ `IG_UNIQUE`) portent le groupe de niveaux 4 : base 0/1/2
  à ~31,7 % chacune, base 3 = **palier 4 à 5 %, une seule ligne par pièce** (`MaxCount` 1, texte
  SYS_OPTION_REPLACE_SUB_OPTION_LEVEL_MAX « Up to 1 sub-options on Legendary 6★ gear can be applied up to Stage 4 »).
  Les reforges sont gardées (« Current reforge values will be maintained »), la valeur reste plafonnée à
  `OptionMaxValue` = 6 ticks. Donc : **6★ Légendaire seulement, une ligne au palier 4 par pièce, autant de passes
  qu'on veut** ; une pièce qui a déjà une ligne au palier 4 (drop 4/3/3/3, native 4/4/3/3) n'a plus rien à gagner.
  Le module modélise le **plafond** (la meilleure ligne au palier 4), comme la projection des reforges modélise des
  rolls max.
- ✅ **`reroll.ts` (pur).** `rerollEligible`, `rerollGains` (gain par ligne : palier de base = `ticks - reforgeTicks`
  porté à 4, sous le plafond LV6 ; null si inéligible ou ligne 4 présente), `rerollMaxGain`, `rerollPotential(piece,
  game, pick)` → `{ index, ticks }` (+1 à +3) ou null — la ligne : la plus forte priorité du héros (clés d'axes,
  `STAT_TO_PRIORITY`), jamais une ligne à priorité négative (pas de Transistone pour une stat dont le héros ne veut
  pas ; toutes négatives → null), sans priorité ou à égalité la plus grande valeur normalisée (`ROLL_NORMS`) — et
  `applyRerollPotential` (base montée, `reforgeTicks` inchangés, valeur au tick).
- ✅ **Projection.** `SolverOptions.rerollPotential` (défaut false, `INITIAL_FILTERS`, persisté avec les filtres par
  héros, défaut false pour un preset nommé plus ancien dans `filterPresets.ts`) ; `SolveFilters.options.rerollPotential`
  optionnel. `projectPieceForReforge` gagne un paramètre `reroll` : le potentiel passe **avant** les reforges (les
  ticks de reforge se répartissent ensuite sous le LV6 de la ligne montée) et s'applique aussi en mode `disable` ;
  `precomputeContext` projette quand le mode reforge ou l'option est actif, **jamais sous Maxed only**. Le contexte
  d'affichage (`ReforgeContext.rerollPotential`, snapshoté par `useSolverSession`, sauvé avec le build et relu par
  `migrateReforge`) le passe à `BottomGearBand`, qui sépare les ticks Transistone des procs de reforge : marqueur
  violet `T+n` sur la ligne, titre « Transistone: base LV b → 4 » (`ResultGearDetail.tsx`, cartes normales et
  compactes). L'interrupteur est un `ToolbarToggle` « Transistone potential » à côté de « Maxed only », dans la
  rangée du mode reforge de la toolbar (c'est là que vivent le mode et Maxed only ; le panneau Options n'a que le
  scope, Keep current et Allow broken sets) ; son titre reprend « Project the best eligible substat line up to level
  4 ».
- ✅ **Qualité.** `QualityScore.reachable` (posé seulement quand la pièce a un potentiel ; max, pourcentage et palier
  restent ceux des rolls actuels) : `qualityScore` prend un `rerollGain` optionnel, `gearPieceQuality` y passe
  `rerollMaxGain` (plus grand gain sur une ligne, indépendant de la priorité). La ligne qualité dit « 11/14 → 13
  reachable » (violet, titre `QUALITY_REACHABLE_HELP`) dans les cartes de résultat et dans la carte d'inspection
  `GearDetail.tsx` — partagée par l'Inventaire et l'infobulle des Builds, seul ajout visuel hors Builder, demandé par
  le lot ; tableau, filtres et répartition de l'accueil inchangés (palier inchangé). Sur une carte déjà projetée
  avec l'option, la ligne est au palier 4 : plus de suffixe.
- ✅ **Tests.** `apps/renderer/test/reroll.test.ts` (nouveau, 13) : éligible / inéligible (étoile, rareté, 3 lignes,
  Talisman / EE), ligne 4 présente (4/3/3/3, 4/4/3/3), palier de base et non total, sans sous-stat, choix par priorité
  (axe `atk` pour `atkPct`), par valeur normalisée (sans priorité, à égalité, priorité hors de la pièce), priorité
  négative écartée, +1 / +2 / +3, plafond LV6 qui saute une ligne, application sans muter la pièce.
  `reforgeProjection.test.ts` (+3) : option à false → pièce telle quelle, à true sans mode reforge → ligne CRC à 4 et
  la bande reprojette pareil, Maxed only l'ignore, avec +10R6 la ligne monte d'abord (+3 ticks au total, 2 reforges
  sur la ligne prioritaire) et le moteur projette la même pièce. `quality.test.ts` (+4) : `reachable` posé seulement
  avec un gain, 3/3/3/2 → 13, rien pour 4/3/3/3 et 4/4/3/3, ni sous 6★ ni sous Légendaire, reforges gardées sous LV6.
  `docs/solver.md` / `wiki/Solver.md` (Options), `docs/reference.md` / `wiki/Engine-Reference.md` (projection) et
  `wiki/Using-the-App.md` (Options) le disent. `npm run typecheck` : `tsc --noEmit` sans sortie dans chaque workspace ;
  `npm test` : `Tests  169 passed (169)`, `Tests  199 passed (199)`, `Tests  729 passed (729)` ; `npm run lint` :
  `✖ 13 problems (0 errors, 13 warnings)`, inchangé.
- ✅ **Laissé, hors périmètre.** Le coût en Transistones, une liste de pièces à reroller, Presets et Worklist. Le ΔCP
  du Builder (`deltaCpLabel`) ne dit « build at … » que pour un mode reforge : en mode Off avec l'option, le build
  est projeté sans que le libellé le dise.
- ⏳ **Sevih, sur le fixe** : Builder › « Transistone potential » → une pièce 4/3/3/3 ne bouge pas, une 3/3/3/1 gagne
  sur sa meilleure ligne (marqueur `T+n` sur la carte), la qualité dit « → N reachable » sans l'option.

### 🧾 Suivi en direct : Worklist lue dans le snapshot courant, pièce disparue dite disparue, `PresetList` nettoyé (2026-10-25)
- ✅ **Pourquoi.** Trois restes du suivi en direct (G44). (1) Une ligne de Worklist affichait le `toName` figé à la mise
  en file, et le `toMain` stocké ne servait nulle part : après un enchant suivi en direct, le nom et la main d'une
  pièce en file pouvaient ne plus être ceux du jeu. (2) Une pièce en file mangée en jeu (fodder d'un enchant,
  dissolution) sort du snapshot, mais la ligne ne le disait qu'en gris (« gone », badge « stale » titré « data
  re-synced »), comptait encore dans le badge de l'onglet (`remainingChangeCount`) et réservait encore la pièce
  (`worklistClaims`) ; une carte dont toutes les lignes avaient disparu se disait « all applied ». (3) Le `PresetList`
  du snapshot gardait l'uid d'une pièce retirée jusqu'au lobby, alors que le client le remet à 0.
- ✅ **Nom et main lus dans le snapshot.** `worklistTarget(c, piece, game)` (`lib/worklist/changes.ts`) rend le nom
  (`pieceName`) et la main (première main hors combat, même règle qu'à la mise en file, factorisée en `pieceMain`) de
  la pièce présente, et ne retombe sur `toName` / `toMain` stockés que quand elle manque (main nulle pour une ligne
  gemme ou une entrée stockée sans `toMain`). `WorklistScreen.tsx` s'en sert pour la ligne de pièce, le « on … » d'une
  ligne gemme hors de sa pièce (nouvelle prop `pieceName` de `GemLine`) et les noms du bandeau « Contested » ; sans
  pièce vivante à dessiner (disparue, ou pas de données de jeu), la ligne montre la main seule sous le nom. Pas de
  migration : les deux champs restent écrits, pour les anciennes entrées et pour le repli.
- ✅ **Pièce disparue.** `gearUids` (`lib/storage/worklist.ts`) donne les uids du snapshot. Une ligne dont `toUid` y
  manque est dite « piece gone (consumed or sold in-game) » en ambre (`PieceGone`, lignes de pièce et de gemme), reste
  non cochable, sort de `remainingChangeCount` et de `worklistClaims` (sans inventaire, les réservations restent
  toutes posées, comme avant) ; le badge d'en-tête devient « gone » en ambre, titré « consumed or sold in-game », et
  la carte ne se dit plus « all applied » quand il ne lui reste que des lignes disparues (« 0 of 1 to do »).
  `reconcileWorklist` gagne un 4e paramètre `previous` (le snapshot d'avant) et rend `gone` : les pièces en file que
  `previous` portait et que le snapshot courant n'a plus, par héros ; la ligne est gardée. `App.tsx` garde le
  snapshot précédent dans une ref et passe `goneNotice(gone)` au toast (« Worklist: 1 queued piece is gone — Hero ») :
  dit une fois, au snapshot qui perd la pièce, rien au premier import (pas de précédent).
- ✅ **`PresetList` nettoyé.** Vérifié dans le client : `CItemInventory.RemoveItem` appelle `DeletePresetEquipUID`,
  qui, dans chaque preset, met à `0L` le premier slot de `m_EquipUIDs` portant l'uid (le slot reste, pas de retrait
  de la liste). `foldEquipEvents` (`apps/desktop/src/equip-events.ts`) note chaque entrée retirée à quantité 0, dans
  l'ordre du journal, et `clearPresetSlots` fait pareil dans chaque `PresetList[].ItemUIDList` (0 numérique ou `"0"`
  selon le type du slot, le fil pouvant écrire les uids des deux façons ; un preset sans `ItemUIDList` est laissé
  tel quel, celui qui ne portait pas la pièce garde sa ref). Une pièce retirée puis rendue par un upsert ne revient
  pas dans le preset, comme dans le client. Chaque slot vidé compte dans `applied`, pour que le snapshot soit écrit.
  Le rejeu reste idempotent : sur un snapshot déjà plié, l'entrée n'existe plus et le slot est déjà à 0. Une pièce
  retirée par un pli antérieur à ce lot reste dans son preset jusqu'au lobby (le rejeu ne la voit plus partir).
  Commentaire de tête du module, `docs/reference.md` et `wiki/Engine-Reference.md` le disent.
- ✅ **Tests.** `apps/renderer/test/worklist.test.ts` (30 → 37) : cible vivante (nom et main d'un talisman après
  enchant, repli sur les valeurs stockées, entrée sans `toMain` et ligne gemme sans main, rendu de l'écran sans le nom
  stocké), pièce disparue (ligne *stale*, hors du badge et des réservations, `reconcileWorklist` qui la garde et la
  signale une fois puis plus, rien sans snapshot précédent, `goneNotice` qui compte les pièces et non les lignes,
  rendu « piece gone » avec nom et main stockés, case désactivée, pas « all applied »).
  `apps/desktop/test/equip-events.test.ts` (32 → 35) : un enchant qui mange la pièce de deux presets met leurs slots à
  0 dans le type de chacun, laisse l'autre preset (même ref) et l'entrée intacts ; idempotence, pièce rendue par
  `merge` qui reste hors du preset ; retrait qu'aucun preset ne porte et preset sans `ItemUIDList` tolérés.
  `docs/reference.md` et `wiki/Engine-Reference.md` à 37 ; `docs/solver.md` (états de la Worklist) et
  `wiki/Using-the-App.md` (« piece gone », toast, nom et main à jour) suivent. `npm run typecheck` : `tsc --noEmit`
  sans sortie dans chaque workspace ; `npm test` : `Tests  169 passed (169)`, `Tests  199 passed (199)`,
  `Tests  709 passed (709)` ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, inchangé.
- ✅ **Piste, hors périmètre : `item/sell` et `item/lock`.** Leurs réponses ne portent pas l'item : `CWebRES_ItemSell`
  ne rend que l'or (`Asset_0`), le client retire les pièces d'après sa requête (`CWebREQ_ItemSell.ItemList`, uids en
  chaînes) ; `CWebRES_ItemLock.OnApply` lit `ItemUID` et `IsLock` de `CWebREQ_ItemLock`. Pour les suivre, le plugin
  devrait journaliser aussi le corps de la requête (`{ seq, at, path, req, res }`) pour ces deux chemins ; l'app
  plierait alors une vente comme des entrées simples à 0 (presets nettoyés compris) et un verrou comme `IsLock`.
  Une pièce vendue en jeu reste donc dans le snapshot jusqu'au lobby, et la Worklist ne la dit disparue qu'à ce
  moment-là. (`item/sell/consumable` porte un `ItemList` de `WSItemData`, mais ne vend que des consommables.)
- ⏳ Sevih, sur le fixe : enchanter en jeu un talisman en file → sa main suit dans la Worklist ; manger en jeu une
  pièce en file → ligne « piece gone » en ambre et toast « 1 queued piece is gone » ; la pièce disparaît aussi de la
  carte du preset qui la portait (onglet Presets), sans repasser par le lobby.

### 💎 Presets : pool de gemmes d'EE avec les réservations de la Worklist, source de la priorité dite juste (2026-10-25)
- ✅ **Pourquoi.** Deux restes des Presets. (1) `bestEeGemsFor` (`lib/presets/eeGems.ts`) appelait `buildGemPool` sans
  `worklistClaims` : une gemme assise sur un Talisman ou une EE libre, réservée par une entrée de Worklist non
  appliquée, était proposée à un autre héros du preset, alors que le Builder et Builds traitent cette pièce comme
  portée par le héros qui la réserve. (2) L'onglet disait la priorité « du Builder de cette session » et le reste à
  faire supposait les filtres par héros persistés : il fallait vérifier ce qui survit vraiment.
- ✅ **Réservations.** `PresetEvalContext` (`lib/presets/evaluate.ts`) gagne `worklistClaims?` ; `App.tsx` passe à
  `PresetsScreen` le même `solverWorklistClaims` que Builder et Builds, l'écran le met dans le contexte (et dans les
  dépendances du `useMemo`), `bestEeGemsFor` le transmet à `buildGemPool`, dont la règle du propriétaire (réservation,
  sinon `equippedBy`, puis `equippedScope: "none"`) écarte la pièce libre réservée pour un autre héros et garde celle
  réservée pour ce héros. Le modèle ne bouge pas : chaque héros du preset garde ses propres gemmes d'EE.
- ✅ **Priorité : ce qui est vrai.** Les filtres par héros du Builder (`lib/storage/heroFilters.ts`,
  `gs.solver.heroFilters`) sont en **sessionStorage**, pas en localStorage : vérifié sur Electron 44.9.3 du dépôt par un
  script jetable (même serveur `http://127.0.0.1:<port>/`, même `userData`) — la valeur survit au rechargement de la
  fenêtre, pas à un relancement, où le localStorage, lui, survit. Le mot « session » est donc juste et la source reste
  `session` (pas de renommage, pas de test à changer). Ce qui était faux, c'est le moment : `BuilderScreen` n'écrit le
  jeu d'un héros qu'en le quittant pour un autre (`snapshotOnHeroSwitch` → `persistHeroFilters`), si bien que le héros
  encore ouvert dans le Builder compte, côté Presets, avec le jeu qu'il avait la dernière fois qu'on l'a quitté (ou pas
  du tout). Textes corrigés en ce sens : en-tête de l'onglet (« the priority each hero was last left with in the
  Builder this session »), `title` du badge « priority from saved build » (« No Builder priority kept this session (the
  Builder keeps a hero's priority when you switch to another hero) — … »), commentaires de `PresetsScreen.tsx` et
  d'`evaluate.ts` (`HeroBase.prioritySource`, `presetPriorityOf`), `docs/solver.md` § Priorité et son miroir
  `wiki/Solver.md`, `wiki/Using-the-App.md` ; le pool de gemmes d'EE y dit aussi les réservations.
- ✅ **Tests.** `apps/renderer/test/presetsGems.test.ts` (12 → 13) : une EE libre de deux gemmes de taux critique est
  proposée à B sans réservation, ne l'est plus réservée pour C, l'est (les deux) réservée pour B ; le test tombe sans le
  correctif. `docs/reference.md` et `wiki/Engine-Reference.md` à 13. `npm run typecheck` : `tsc --noEmit` sans sortie
  dans chaque workspace ; `npm test` : `Tests  169 passed (169)`, `Tests  199 passed (199)`, `Tests  702 passed
  (702)` ; `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, inchangé.
- ⏳ **Sevih sur le fixe** : une gemme d'une EE (ou d'un Talisman) libre réservée par la Worklist pour un héros
  n'apparaît plus dans les gemmes proposées à un autre héros du preset ; réservée pour ce héros, elle y reste.
- ⏳ **Laissé, hors périmètre.** (a) Le héros ouvert dans le Builder n'est vu par les Presets qu'une fois quitté : écrire
  son jeu à chaque changement de filtres (ou au départ de l'onglet) toucherait `BuilderScreen`, à décider. (b) Une pièce
  portée par un autre héros mais réservée par la Worklist pour ce héros reste hors du pool de gemmes d'EE (le préfiltre
  des pièces portées passe avant la réservation), comme avant ; le Builder, lui, la compterait au héros.

### 🗜️ Builder : mode compact des cartes de la build sélectionnée, réglage Settings › Solver (2026-10-23)
- ✅ **Pourquoi.** Demande de Sevih du 23/10 : comparer les huit cartes de la bande d'un coup, sans ce qui n'apporte rien
  (noms d'objets longs, libellés de stats que l'icône dit déjà, effets sur plusieurs lignes).
- ✅ **Écart avec l'énoncé.** Le lot visait `GearDetailBody` (`design/GearDetail.tsx`), mais la bande ne le rend pas :
  `GearCard` → `ResultItemDetail` → `ResultGearDetailBody`, le fork de `design/ResultGearDetail.tsx`, qui avait déjà
  l'icône à 56 px, ni ligne rareté / classe, ni effets de set 2-pc / 4-pc, ni effet unique (ils vivent dans le panneau
  Effects de la build), une qualité sur une ligne (« 14/20 Good ») et pas de main pour l'EE. Le mode compact est donc
  posé sur le fork ; `GearDetailBody`, l'Inventaire et les tooltips (Builds, Presets) ne sont pas touchés. Les points
  sans objet sur le fork (ligne rareté / classe, icône 80 → 56, effets de set, effet unique, effets de combat) n'ont rien
  à retirer ; je n'ai rien ajouté pour les faire apparaître. Qualité : la ligne existante « 14/20 Good » est gardée telle
  quelle (le « Quality 78 % · Good » de l'énoncé serait plus long), le texte d'aide de l'Inventaire passe en `title`.
- ✅ **Réglage.** `App.tsx` : `usePersistedState("gs.builder.compactCards", false)`, passé à `SettingsModal` (champs
  `compactCards` / `setCompactCards` de `SolverSettings`) et à `BuilderScreen` (`compactCards`) → `BottomGearBand`
  (`compact`) → `GearCard` → `ResultItemDetail` → `ResultGearDetailBody`, tous à `false` par défaut.
  `design/settings/SolverPane.tsx` : Switch « Compact result cards » sous le heatmap, avec le hint demandé.
- ✅ **Carte compacte.** En-tête : `compactName(piece, game)` (exportée, pure) — « EE » pour l'exclusive, le nom du set
  (`game.sets[armorSetId].name`) pour casque / armure / gants / bottes, à défaut le nom de la pièce, le nom tel quel
  sinon ; plus de « - [Singularity] » en seconde ligne, le dégradé vertical reste (il lit `piece.singularity`), le nom
  complet avec le suffixe en `title`. Mains : icône + valeur, le libellé en `title`. Sous-stats : badge du niveau (fond
  ambre à 6), à côté le marqueur cyan `+N` des ticks ajoutés par la projection quand il y en a, icône, valeur ; le
  libellé et « LV n (base + reforges [+ extrapolés]) » en `title`. Effets du talisman (multi-tiers) et effet Singularity :
  une ligne `truncate` chacun, les sauts de ligne du texte du jeu remplacés par des espaces (sinon le `<br>` de
  `GameText` casse la ligne), couleurs gardées, texte brut complet en `title`. Gemmes inchangées. Carte `w-64` au lieu
  de `w-80` (état vide compris, pour garder la grille alignée), corps en `space-y-2` au lieu de `space-y-3` ; portrait du
  porteur, pied « exclude » et état vide conservés.
- ✅ **Grille de la bande.** `BottomGearBand` : en compact le seuil de la grille 4 × 2 passe de 1616 à 1360 px —
  4 × 256 (`w-64`) + 3 × 8 (gaps) + 288 (colonne `w-72`) + 8 (gap) + 16 (`p-2`) = 1360 ; les deux jeux de classes sont
  écrits en entier (Tailwind ne voit pas un seuil calculé).
- ✅ **Test.** `apps/renderer/test/compactName.test.ts` : EE, armure avec set (les quatre slots), armure à set inconnu ou
  sans `game`, arme / accessoire / talisman, suffixe Singularity absent et `singularity` (le dégradé) intact. Le rendu
  n'a pas de test (pas de testing-library dans le dépôt).
- ✅ **Docs.** `docs/solver.md` / `wiki/Solver.md` (section BottomGearBand : mode compact et seuil),
  `wiki/Using-the-App.md` (Settings › Solver, bande des cartes), `docs/release-notes.md › [Unreleased]`, commentaire
  d'en-tête de `SettingsModal.tsx`.
- ✅ **Vérifs.** `npm run typecheck` : `tsc --noEmit` sans erreur ; `npm test` : `Tests  701 passed (701)` (renderer, dernier workspace ; core et desktop 169 et 196) ;
  `npm run lint` : `✖ 13 problems (0 errors, 13 warnings)`, inchangé.
- ✅ **Propositions (hors diff).** La ligne qualité pourrait tomber à « 14/20 » seule (le palier se lit à la couleur) ;
  les effets du talisman pourraient ne garder que le palier actif.
- ⏳ **Sevih sur le fixe** : Settings › Solver › Compact result cards → les huit cartes se raccourcissent (noms de set,
  « EE », stats icône + valeur, effets sur une ligne, plus de « - [Singularity] » mais le dégradé reste, grille 4 × 2 dès
  1360 px) ; l'Inventaire et les tooltips ne bougent pas ; le réglage survit au redémarrage.

### 🧩 Builder : cartes de la build sélectionnée dans l'ordre de l'écran d'équipement du jeu, ordre partagé avec Builds et Presets (2026-10-23)
- ✅ **Pourquoi.** Retour de Sevih du 23/10 : la bande du bas du Builder alignait ses huit cartes en `flex-wrap`, au gré de
  la largeur, alors que Builds et Presets les posent en grille 4 × 2 comme l'écran d'équipement du jeu ; et l'ordre du jeu
  vivait en trois copies (`BUILD_SLOT_ORDER` dans `BuildsScreen.tsx`, `GAME_GRID` dans `PresetsScreen.tsx`,
  `RESULT_GEAR_SLOTS` dans `BottomGearBand.tsx`), qu'un réordonnancement aurait fait diverger.
- ✅ **Un seul ordre.** `design/tokens.ts` : `GAME_GEAR_GRID: readonly SlotId[]` (Arme, EE, Tête, Torse / Accessoire,
  Talisman, Gants, Bottes), commenté « écran d'équipement, 4 × 2 », à côté de `SLOTS` qui reste l'ordre de l'onglet
  Inventaire (inchangé), plus `toEngineSlot(s)` (talisman → `ooparts`), l'inverse de `toDesignSlot`. `BuildsScreen` et
  `BottomGearBand` l'importent (`BUILD_SLOT_ORDER` et `RESULT_GEAR_SLOTS` supprimés, la conversion en ligne de la bande
  passe par `toEngineSlot`) ; `PresetsScreen` dérive son `GAME_GRID` en slots moteur (`GAME_GEAR_GRID.map(toEngineSlot)`).
  Le commentaire de `SolveBuild.pieceUids` (`lib/solver/types.ts`) citait `RESULT_GEAR_SLOTS` à tort : l'ordre des uids
  est celui du moteur (weapon, helmet, armor, gloves, boots, accessory, exclusive, ooparts — talisman en dernier, que lit
  `variantSignature`), sans lien avec l'affichage ; le commentaire le dit, l'ordre du champ ne change pas.
- ✅ **Grille de la bande.** `BottomGearBand` : `flex flex-wrap gap-2` reste la base (même ordre, cartes à leur largeur),
  et la bande passe en grille `grid-cols-[repeat(4,max-content)]` au-delà d'un seuil arbitraire `min-[1616px]:`. Ni `xl`
  (1280) ni `2xl` (1536) ne suffisent : les cartes (`ResultItemDetail`) font `w-80`, et `BuilderScreen` encadre la bande
  de `p-2`, d'un `gap-2` et de la colonne de droite `w-72` — 4 × 320 + 3 × 8 + 8 + 288 + 16 = 1616 px (les barres de
  défilement sont masquées par `theme.css`, rien à ajouter). Colonnes `max-content` plutôt que `grid-cols-4` : en `1fr`,
  une fenêtre large aurait écarté les cartes. En dessous (fenêtre par défaut de 1480 px), trois cartes par rangée dans
  l'ordre du jeu. Rien d'autre ne change dans les cartes.
- ✅ **Test.** `apps/renderer/test/gameGearGrid.test.ts` : les 8 slots une fois chacun, `weapon`, `exclusive` en tête, et
  l'aller-retour `toEngineSlot` / `toDesignSlot`.
- ✅ **Docs.** `docs/solver.md` / `wiki/Solver.md` (section BottomGearBand : ordre partagé, grille et seuil ; Presets :
  `GAME_GEAR_GRID` au lieu du `GAME_GRID` de l'écran), `wiki/Using-the-App.md` (la bande suit l'écran d'équipement),
  `docs/release-notes.md › [Unreleased]`.
- ✅ **Vérifié.** `npm run typecheck` (dernière ligne `> tsc --noEmit`, sans erreur) ; `npm test` (`Tests  696 passed
  (696)`) ; `npm run lint` (`✖ 13 problems (0 errors, 13 warnings)`, inchangé).
- ⏳ Sevih sur le fixe : les huit cartes de la build sélectionnée sont en deux rangées Arme | EE | Tête | Torse /
  Accessoire | Talisman | Gants | Bottes, comme Builds et Presets (fenêtre d'au moins 1616 px de large ; plus étroite, le
  même ordre passe à la ligne).

### 🎯 Builder : taux critique brut au-delà de 100 visible dans les résultats et dans « Current → Projected » (2026-10-23)
- ✅ **Pourquoi.** Retour de Sevih du 23/10 : la feuille borne `critRate` à 100 comme le client (`composeBuild.ts`) et
  garde la somme brute dans `critRateUncapped`, que le Builder n'affichait nulle part — deux builds à 100 de crit dans le
  tableau pouvaient cacher 101 et 142 de crit brut. Le moteur et l'onglet Builds (règle 4, `lib/overcap.ts` de G49) la
  lisaient déjà ; le tableau et le panneau la montrent maintenant.
- ✅ **Formatage, module pur.** `screens/builder/critCell.ts` (nouveau) : `critRawOf(fs)` (`critRateUncapped ??
  critRate`), `critCellParts(fs)` → `{ shown, over }` (`shown` = la CHC de la feuille, `over` = `round1(brut − critRate)`,
  0 quand il n'y a pas de dépassement) et `critCellTitle(fs)` → « Crit rate 142% raw — capped at 100% in-game, 40% wasted
  over the 102% tolerance », ou « …, within the 2% buffer » entre 100 et 102, `undefined` sans dépassement. Le gaspillage
  vient de `overcapOf` (pas recopié) ; la tolérance est exportée de `lib/overcap.ts` en `CRIT_TOLERANCE = 102` (le
  littéral 102 de `overcapOf` la lit) pour que la phrase du tampon ne refasse pas le calcul. Les « % » sont collés comme
  dans `overcapText`, à l'anglaise.
- ✅ **Tableau (`ResultsTable.tsx`).** La cellule CHC garde `fmt` (« 100% ») et ajoute un `<sup>` ambre « +42 »
  (`text-[8px] leading-none`, la hauteur fixe de ligne ne bouge pas) avec le tooltip ci-dessus ; la heatmap de la
  cellule et `computeColumnRanges` (désormais exporté, avec `ColumnRanges`) lisent `critRawOf`, le tri aussi
  (`sortKey === "critRate"`). Le menu de seuil du clic droit (G48) garde la valeur de la feuille : les filtres de stats
  bornent la CHC de la feuille. L'en-tête le dit : `STAT_TOOLTIP` (`statColumns.ts`) prend un `note` facultatif,
  `statHeaderTooltip` l'ajoute (seul `critRate` en a un ; seul l'en-tête du tableau appelle la fonction).
- ✅ **Panneau « Current → Projected » (`StatsPanel.tsx`).** La ligne crit passe les valeurs brutes à `StatsPanelRow`
  (delta et teinte vert / rose calculés dessus) et, de chaque côté, un `CappedSide` `{ shown, over, title }` : le petit
  `CappedValue` affiche « 100% » + exposant ambre « +42 » quand `over > 0`, la valeur de la feuille sinon ; tooltip
  `critCellTitle` sur la valeur. Les autres lignes et la ligne CP de G48 sont inchangées.
- ✅ **Bande et cartes de pièces : rien.** `BottomGearBand` n'affiche que les stats de chaque pièce (main, subs,
  gemmes), aucun total de crit borné ; `DmgPer1PctPanel` ne montre pas de valeur de crit. Pas de changement.
- ✅ **Docs.** `docs/solver.md` / `wiki/Solver.md` (§ Stats, § ResultsTable, renvoi dans « Overcap »),
  `wiki/Using-the-App.md` (lecture des résultats), `docs/reference.md` / `wiki/Engine-Reference.md` (ligne
  `critCell.test.ts`, carte des modules pour `overcap.ts`), `docs/release-notes.md › [Unreleased]` (« Builder: crit
  rate past 100 % shows its raw value (+N) in the results and the stats panel »).
- ✅ **Tests.** `test/critCell.test.ts` (7) : 142 brut → `{ shown: 100, over: 42 }` ; 100 pile et 85,5 → `over` 0 ;
  arrondi à 0,1 (100,36 → 0,4) et repli sur `critRate` sans somme brute ; tooltip à 142 (40 gaspillés) et à 101,5 (dans
  le tampon), aucun sous 100 ; `computeColumnRanges` sur trois builds (142 / 100 / 80 brut) → plage crit `{ 80, 142 }`.
  `npm run typecheck` : « > tsc --noEmit » (code 0) ; `npm test` : « Tests 693 passed (693) » (renderer ; core 169,
  desktop 196) ; `npm run lint` : « ✖ 13 problems (0 errors, 13 warnings) », inchangé.
- ⏳ Sevih sur le fixe : une build à crit brut > 100 montre « 100% ⁺N » en ambre dans la colonne crit et dans
  « Current → Projected » (des deux côtés si la tenue actuelle dépasse aussi), tooltip avec la valeur brute et le
  gaspillage ; la colonne crit se trie et se colore sur la valeur brute.

### 🧭 Presets et Worklist : pleine largeur, grille des pièces comme en jeu avec l'EE du héros de référence, avertissement d'overcap (2026-10-23)
- ✅ **Overcap, règle partagée.** Trois retours du banc de Sevih (23/10) ; le troisième : Regina associée à « Striker 1 »
  (référence D.Lambda) dépassait de loin 100 % de taux critique sans aucun signe sur sa ligne. La règle 4 de
  `buildAdvice.ts` (« wasted stat caps ») est extraite dans `lib/overcap.ts` (nouveau, pur) : `overcapOf(finalStats)` →
  `{ key, label, value, cap, waste }` par axe en dépassement — crit lu sur `critRateUncapped ?? critRate` (la feuille
  borne `critRate` à 100, `composeBuild.ts`) contre 102, pénétration contre 100, `waste = round1(value − cap)` gardé
  s'il est positif — et `overcapText` (« Crit rate 142% — 40% wasted over the 102% cap », le texte de Builds à l'identique) ;
  `computeAdvice` les appelle, ses tests inchangés restent verts. Module à côté de `buildAdvice.ts` plutôt que dans
  `lib/presets/` : c'est la règle de Builds, Presets la consomme.
- ✅ **Overcap sur les lignes de héros.** `lib/presets/evaluate.ts` : `OVERCAP_WARN_PTS = 10` (exporté, pas un
  réglage) et `presetOvercap(shown, socketed)` → les dépassements de l'évaluation affichée (`evalPreset`, avec les
  gemmes d'EE proposées), chacun avec `warn` (waste ≥ 10) et `fromGems` (dépassement plus fort qu'avec les gemmes
  telles que serties, `asSocketed` ; faux quand aucune gemme n'est proposée). `HeroLine`, référence comprise : un badge
  par axe, orange quand `warn` et la ligne passe au ton d'avertissement de la perte (`warn || overcap.some(o => o.warn)`),
  ambre seul en dessous ; le tooltip du badge dit « Further over the cap with the proposed EE gems than as socketed. »
  quand `fromGems`, puis que le surplus est perdu.
- ✅ **Grille du jeu.** `PresetPieces` : grille 4 × 2 (`GAME_GRID` dans l'écran) Arme, EE, Tête, Torse / Accessoire,
  Talisman, Gants, Bottes ; les pièces de slot inconnu suivent sur une rangée à part ; `PRESET_SLOTS` intact (signature,
  worklist, tests). La case EE montre `eeOf(referenceUid)` (référence choisie ou porteur unique proposé), `opacity-60`,
  RichTooltip « EE isn't part of a preset — each hero keeps their own » au-dessus du détail de la pièce ; sans
  référence ou sans EE, la tuile vide en pointillé de `SlotMini` avec la même phrase en `title`.
- ✅ **Largeur.** Worklist : plus de `mx-auto max-w-3xl`, en-tête de transaction pleine largeur, cartes dans une grille
  `grid-cols-1 items-start xl:grid-cols-2` (chacune à sa hauteur). Presets : sous le bandeau d'avertissements, une
  carte ouverte est `xl:flex-row` — la grille (largeur fixe, `shrink-0`) à gauche, Reference / Associated en
  `flex-1` à droite ; empilée en dessous de 1280 px. Lignes de héros : métriques, perte, badges dans un bloc `flex-1`
  (`gap-x-6`), `Metric` en `min-w-24` pour s'aligner d'une ligne à l'autre ; textes à 10 / 10,5 px passés à 11 / 11,5
  (Worn by, Reference, Associated, current wearer, Add the heroes…, as socketed, priority from saved build, stat
  principale sous les tuiles). Rien d'autre ne bouge.
- ✅ **Docs.** `docs/solver.md` / `wiki/Solver.md` (§ Presets : « Disposition » / « Layout », « Overcap », carte des
  fichiers), `wiki/Using-the-App.md` (Presets : grille, EE, Overcap ; Worklist : pleine largeur),
  `docs/reference.md` / `wiki/Engine-Reference.md` (ligne `presetsOvercap.test.ts`, carte des modules),
  `docs/release-notes.md › [Unreleased]`.
- ✅ **Tests.** `test/presetsOvercap.test.ts` (9) : sous les caps → rien ; 102 de crit pile et 100 de PEN → rien ; crit
  brut 142 avec `critRate` 100 → waste 40 et le texte de Builds ; repli sur `critRate` sans somme brute ; PEN 120 → 20 ;
  deux axes, crit d'abord ; `presetOvercap` : ton d'avertissement à `OVERCAP_WARN_PTS` pile et pas à 9,9, sans
  évaluation → rien, `fromGems` (plus fort / nouveau avec les gemmes proposées → vrai ; identique ou sans proposition →
  faux). `npm run typecheck` : « > tsc --noEmit » (code 0) ; `npm test` : « Tests 686 passed (686) » (renderer ; core
  169, desktop 196) ; `npm run lint` : « ✖ 13 problems (0 errors, 13 warnings) », inchangé.
- ⏳ Sevih sur le fixe (fenêtre large) : Worklist et Presets remplissent la fenêtre, deux colonnes ; la grille d'un preset
  est Arme | EE | Tête | Torse / Accessoire | Talisman | Gants | Bottes avec l'EE du héros de référence atténuée ;
  Regina sur « Striker 1 » porte un badge « Crit rate …% — …% wasted over the 102% cap » et sa ligne est orange.

### 🎚️ Builder : CP avant / après dans « Current → Projected », colonne « Swaps », seuils par clic droit sur le tableau (2026-10-23)
- ✅ **CP avant / après.** `StatsPanel` reçoit `cp: { current, projected }` et ouvre le panneau par une ligne « CP » au
  même format que les stats (courant ▸ projeté, delta signé, vert / rose / neutre selon le delta) ; `StatsPanelRow`
  prend désormais une icône, une unité et les deux valeurs, la ligne CP occupe la moitié gauche de sa rangée (une
  cellule `col-span-4` la complète) pour que les paires de stats gardent leur grille. Pas d'icône CP dans `STAT` :
  libellé texte au style du repli de `StatIcon`. `BuilderScreen` passe `composition?.currentCp` et
  `selectedBuild?.cp` ; le badge `deltaCpText` au-dessus de la bande d'équipement reste.
- ✅ **« Upg » → « Swaps ».** Le nombre compte des slots qui changent, pas des améliorations : en-tête `swaps`,
  tooltip « Slots that change vs the hero's current loadout — not upgrades to do », tooltip de cellule (« N slot(s)
  change vs the current loadout »), entrée du menu des colonnes, ligne et hint du panneau Rating filters. Clés
  inchangées (`ratingFilters.upg`, `colPrefs["upg"]`, `WorklistEntry.upg`, `build.upg`) ; aucun libellé « upg »
  visible dans la Worklist. Docs : `docs/solver.md` / `wiki/Solver.md` (ResultsTable), `wiki/Using-the-App.md`,
  `wiki/FAQ.md` (la question « What's the "Upg" column? »), titre 2.11 de `docs/reference.md` /
  `wiki/Engine-Reference.md`.
- ✅ **Seuils par clic droit.** Clic droit sur une cellule de stat, de rating ou de CP → `CellMenu` à la position du
  clic (fixe, ramené dans la fenêtre) : « Min ≥ v », « Max ≤ v » (v = `roundDisplay`, la valeur imprimée, avec
  l'unité), « Cancel » ; Échap et clic dehors (`useClickOutside`) ferment. `ResultsTable` reçoit `onThreshold(kind,
  key, bound, value)` ; l'ouvreur passé aux lignes est stable (`useCallback`) pour ne pas casser le memo de
  `ResultRow`. Pas de menu sur score, swaps, effets, ★ ; le clic droit ne sélectionne pas la ligne. `BuilderScreen`
  dispatche `setStatFilter` (stat) ou `setRatingFilter` (rating, CP compris), l'autre borne gardée, et relance
  `startSolve(lastSolveMode)` : `startSolve` lit `filters` dans sa fermeture, périmée dans le handler, donc le mode
  est mis dans un ref et un effet sur `filters` lance le solve au rendu qui porte la nouvelle borne (un ref plutôt
  qu'un état : un `setState` dans l'effet ajoutait un avertissement `set-state-in-effect`). Les panneaux de filtres
  lisent `filters` et montrent la borne ; une colonne de stat bornée est déjà forcée visible. `builderFilters.ts`
  non touché. Pas de test de rendu : ni `@testing-library` ni jsdom, la logique ajoutée est du câblage de composant.
- ✅ **Vérifié.** `npm run typecheck` : `tsc --noEmit` sans erreur (exit 0) ; `npm test` : « Tests  686 passed (686) »
  (dernier workspace) ; `npm run lint` : « ✖ 13 problems (0 errors, 13 warnings) », inchangé.
- ⏳ **Remarque.** La borne est la valeur affichée, arrondie : un « Min ≥ 85.3% » posé sur une ligne à 85.26 l'exclut
  (idem un entier ≥ 100 arrondi vers le haut). Conforme à la demande ; à revoir si ça gêne au banc.
- ⏳ **Sevih sur le fixe** : la ligne CP en tête de « Current → Projected » avec le delta ; la colonne s'appelle
  « Swaps » ; clic droit sur une valeur → « Min ≥ » / « Max ≤ » pose le seuil, le panneau de filtres le montre et le
  solve repart.

### 🎯 Presets : « Optimize preset → » — mêmes effets d'arme / accessoire / talisman requis, sous-stats prioritaires depuis la tenue et la reco (2026-10-23)
- ✅ **Le patch.** Demande de Sevih après G46 : « Optimize → » sur la ligne de référence ouvrait le Builder sur le héros
  sans rien d'autre. `lib/presets/optimize.ts` (nouveau, pur) : `presetOptimizePatch({ pieces, reco, game,
  talismanFamily })` → `{ patch: RecoFilterPatch, build, notes }`. Effets : le `setId` de l'arme et de l'accessoire de la
  tenue (`game.equipment[String(itemId)]?.setId`, la clé du moteur) et la famille du talisman (`talismanFamilyKeys`),
  toutes en `required` — les mêmes effets, pas « preferred » ; un slot sans pièce dans la tenue (vide ou plus dans
  l'inventaire) ou une pièce sans `setId` reste ouvert, avec une note. Sous-stats : pour chaque clé de priorité (les
  variantes plate et % comptent une fois par pièce, via `STAT_TO_PRIORITY`), le nombre de pièces de la tenue, talisman
  et EE à part, qui la portent (4+ → 3, 3 → 2, 2 → 1, sinon 0) ; la reco, la première build (`Object.keys(builds)[0]`,
  son nom dans les notes quand il y en a plusieurs), traduite par `translateRecoBuild` (`SubstatPrio` en 3/2/1) ; poids
  = max des deux, ordre poids puis présence dans la reco puis nombre de pièces, coupe à 5 clés, les autres absentes du
  patch (jamais -1). Mains : celles de la reco pour l'arme et l'accessoire, rien de la tenue. Sans reco (404, erreur,
  hors ligne) : la tenue seule, note « No outerpedia reco: substats from the outfit only. ». `presetOptimizeNote` écrit
  la ligne de statut : « Optimizing preset #<num> <name> — same weapon / accessory / talisman effects required, N
  priority substats from the outfit + outerpedia's "<build>" reco. » (ou « from the outfit. »), suivie des notes.
- ✅ **Sets : ouverts, réducteur inchangé.** Le patch porte `setPlans: []` et `mergePreset` en fait `[[]]` : les plans
  mémorisés du héros sont remplacés par un plan vide. Choisi tel quel, sans cas « absent = inchangé » : le lot dit « le
  preset garde ses sets ouverts », et les plans mémorisés viennent souvent d'un « Get preset » précédent, la reco
  complète que ce bouton n'applique pas. `excludedSets`, bornes, options et `topPct` restent ceux du héros ; la
  priorité est remplacée par celle du patch (comme « Get preset »).
- ✅ **Type.** `RecoFilterPatch.talismanEffectPicks` passe de `"preferred"` à `"required" | "preferred"` (pas
  `ChipState` comme suggéré : son `"off"` ne s'assigne pas au `TalismanEffectConstraint` du moteur et cassait le
  typecheck de `talismanPreferred.test.ts`) ; `translateRecoBuild` produit toujours `"preferred"`.
- ✅ **Plomberie.** `PresetsScreen` reçoit `onOptimizePreset(heroUid, patch, note)` ; sur la ligne de RÉFÉRENCE seulement
  (et avec les données du jeu), le bouton devient « Optimize preset → », « Fetching… » et désactivé pendant
  `fetchRecoForHero` (le `currentUid` est un ref qui vaut l'uid de la ligne tant qu'elle est montée : une réponse
  arrivée après un changement de référence ou un démontage est jetée) ; les lignes associées gardent « Optimize → ».
  `App.tsx` : `builderPatch` à côté de `builderHero`, passé en `initialPatch`, vidé avec lui par
  `onInitialHeroConsumed` (et remis à null par un « Optimize → » simple). **Écart au lot sur l'endroit de la fusion** :
  l'effet de `initialHeroUid` ne peut pas fusionner quand le héros change — il tourne sur les filtres du héros SORTANT,
  que l'effet de changement de héros mémoriserait puis écraserait par ceux du héros entrant. Donc : héros déjà chargé
  (montage du Builder, ou même héros) → fusion et note dans l'effet de `initialHeroUid` ; sinon le patch attend dans
  `pendingPatchRef`, l'effet de changement de héros le fusionne juste après `loadPreset` / `resetAll` (le patch se
  superpose aux filtres mémorisés du héros entrant, voulu), et l'effet de remise à zéro du statut reco affiche la note
  au lieu de vider. Ce dernier ne tourne plus tant que le héros ne change pas (montage, re-run de StrictMode), sans quoi
  il effaçait la note fusionnée au montage ; l'effet de `initialHeroUid` a été déplacé sous les états reco qu'il
  utilise (même ordre relatif aux autres effets).
- ✅ **Tests.** `apps/renderer/test/presetOptimize.test.ts` (9) : effets des trois pièces et talisman élargi, pièce
  manquante / sans effet, poids de la tenue seule (talisman et EE ignorés, atk + atkPct comptés une fois), fusion avec
  la reco (max, ordre, coupe à 5, nom de la build et « first of 2 »), tenue vide, mains de la reco seulement et
  `setPlans` vide, passage par `mergePreset` (bornes gardées, `setPlans` → `[[]]`, talisman `required`),
  `presetOptimizeNote` avec et sans reco. Pas de test du réducteur : non touché. `npm run typecheck` : `> tsc --noEmit`
  sans erreur ; `npm test` : « Tests  677 passed (677) » ; `npm run lint` : « ✖ 13 problems (0 errors, 13 warnings) »
  — un de moins qu'avant, l'effet de remise à zéro du statut reco revenant tôt n'est plus signalé.
- ✅ **Docs.** `docs/solver.md` / `wiki/Solver.md` (onglet Presets, renvoi depuis le Builder, arbre),
  `wiki/Using-the-App.md`, `docs/reference.md` / `wiki/Engine-Reference.md` (arbre, tests), `docs/release-notes.md` ›
  [Unreleased]. Rien dans `docs/todo.md` sur ce point.
- ⏳ **Sevih sur le fixe** : « Optimize preset → » sur la ligne de référence d'un preset → le Builder s'ouvre sur le
  héros, les chips d'effet de l'arme, de l'accessoire et du talisman de la tenue sont « required », 4-5 sous-stats ont
  une priorité, la ligne de statut dit d'où elles viennent ; sans réseau, la variante « from the outfit » et sa note.
  À essayer aussi Builder déjà ouvert sur un autre héros, puis sur le même héros (les deux chemins de la fusion).
  Hors périmètre, non fait : exclure les pièces des autres presets, figer celles du preset, choisir la build de la reco.

### 🗂️ Onglet Presets : ordre du jeu, filtre et tri par classe, Optimize par héros, menu des héros au-dessus des cartes (2026-10-22)
- ✅ **Ordre du jeu.** Retour du banc de Sevih sur la 1.14.0 : les cartes suivaient le `num` croissant, pas l'éditeur
  du jeu. Lu dans le client décompilé : `CItemInventory.InitPresetList` donne à chaque preset `m_nSort` = le `SortOrder`
  de la première entrée de `PresetOrderList` portant son `Num` (sans regarder le `PresetType`, 0 sinon), et
  `CEquipPresetData.SortPreset` trie favoris d'abord, `m_nSort` décroissant, puis `Num` (le `m_nID == 0` en dernier est
  l'emplacement « nouveau » de l'éditeur, pas une donnée). Core : `RawPresetOrder` (`raw.ts`, tous champs optionnels) à
  la place de `unknown[]` ; `Preset` gagne `presetType` et `sortOrder` (0 par défaut, `parse.ts` › `presetSortOrders`
  reproduit `GetOrderValue`) ; `comparePresets` exporté (type croissant — le client tient une liste par `PRESET_TYPE`,
  les Master League passent donc après —, favoris, `sortOrder` décroissant, `num`) ; `presetRows` trie avec. Le `#num`
  reste sur la carte. **La forme de `PresetOrderList` est déduite du client, aucune capture réelle sur le portable** :
  fixtures écrites d'après `WSItemPresetOrderData` / `WSItemPresetSortData` ; si la liste manque ou a une autre forme,
  tout `sortOrder` vaut 0 et l'ordre retombe sur favoris puis numéro. `docs/data-schema.md` / `wiki/Data-Schema.md`
  disaient `PresetType` non lu : corrigés, avec la forme de `PresetOrderList`.
- ✅ **Menu déroulant derrière la carte suivante.** Chaque `<section>` de `PresetCard` portait `backdrop-blur-sm` : un
  `backdrop-filter` fait de la carte un contexte d'empilement, le `z-30` de la liste de `HeroSelect` y restait confiné
  et la carte suivante, peinte après, passait dessus. Classe retirée (le fond `bg-bg-elev-2` reste), commentaire à la
  place. Vérifié par lecture du DOM, pas de navigateur : entre la carte et la liste, ni `overflow`, ni `transform`, ni
  `filter`, ni `z-index` (`div.w-56` puis le `div.relative` de `HeroSelect`) ; le conteneur défilant `overflow-y-auto`
  ne crée pas de contexte d'empilement ; dans les cartes suivantes, les seuls éléments empilés sont les badges
  « missing / shared » (`-translate-x-1/2`, sans `z-index`), les calques `z-10` des portraits (supprimés sous 40 px,
  les portraits des presets font 28 et 32 px) et l'icône de slot vide `opacity-35`, tous sous `z-30`. Ni
  `HeroSelect` ni le Builder ne bougent.
- ✅ **Filtre et tri par classe.** Barre du haut, à droite du texte d'aide : les cinq chips de classe (multi-sélection,
  mêmes icônes `IG_Turn_Class_*` et même style que Builds), « Sort: In-game · Class » et « Clear » quand un filtre est
  actif. La liste est `CLASSES` de `lib/homeStats.ts`, désormais exportée (pas une troisième copie ; `CLASS_CHOICES`
  de `BuildsScreen.tsx` reste locale, l'importer aurait tiré l'écran Builds, chargé à la demande, dans le paquet de
  Presets) : les chips suivent donc l'ordre de l'accueil (Striker, Ranger, Mage, Defender, Healer), pas celui de
  Builds. `presetClasses` (`lib/presets/presetRows.ts`) : classes des pièces présentes (`GearPiece.classLimit`, le
  `CCT_*` brut que `parse.ts` tire de `EquipmentDef.classLimit` — même valeur que `EquipmentDef.class` en nom affiché,
  sans passer par le `GameData`) ; deux pièces de deux classes gardent les deux — c'est un preset incohérent, il
  apparaît sous les deux chips ; sans pièce restreinte, repli sur le héros de référence enregistré, puis les porteurs
  (le porteur unique proposé comme référence y est donc couvert), puis les associés ; sinon inconnue.
  `arrangePresets` : un filtre garde une carte dont une classe est cochée et masque les cartes vides et inconnues ;
  « Class » trie par la première classe de la carte dans l'ordre des chips (cochées seules quand un filtre est actif),
  inconnues à la fin, ordre du jeu dans une classe (tri stable). Icône de classe à côté du nom quand elle est connue ;
  la pastille garde « N used · M total » et ajoute « · K shown » quand des cartes sont masquées ; une ligne « No preset
  of the selected classes. » si plus rien ne reste. État en `useState`, perdu au changement d'onglet.
- ✅ **Optimize →.** `PresetsScreen` reçoit `onOptimize` d'`App.tsx` (même callback que Builds :
  `setBuilderHero(uid); setTab("Builder")`) ; chaque `HeroLine`, référence et associés, montre le `CyanButton
  size="sm"` de Builds à côté de « + Worklist ». Il ouvre le Builder sur le héros, rien d'autre. Piste hors périmètre :
  ouvrir le Builder avec le contexte du preset (exclure les pièces des autres presets, fixer celles du preset).
- ✅ **Docs.** `docs/solver.md` / `wiki/Solver.md` (section Presets : ordre, filtre et tri, Optimize ; arbre des
  fichiers), `docs/reference.md` / `wiki/Engine-Reference.md` (tables des tests, arbre), `wiki/Using-the-App.md`,
  `docs/release-notes.md` › [Unreleased]. `wiki/FAQ.md` n'évoque pas l'ordre des presets : inchangé.
- ✅ **Tests.** `packages/core/test/parse.test.ts` (+3 : `PresetOrderList` lu par `Num` avec un `Num` sans entrée → 0
  et le `PresetType`, liste absente ou entrées sans champs → 0, `comparePresets`) ; `apps/renderer/test/presets.test.ts`
  (+10 : ordre favoris / `sortOrder` / num / Master League, `presetClasses` arme restreinte, accessoire restreint,
  deux classes, repli référence → porteurs → associés, inconnue, `arrangePresets` filtre, cartes vides et inconnues
  masquées, tri par classe avec et sans filtre) ; les fixtures `Preset` de `presets.test.ts` et
  `presetsGems.test.ts` prennent les deux champs. `npm run typecheck` : vert (dernière ligne `> tsc --noEmit`, sans
  erreur) ; `npm test` : `Tests  169 passed (169)` (core), `Tests  196 passed (196)` (desktop),
  `Tests  668 passed (668)` (renderer) ; `npm run lint` : `✖ 14 problems (0 errors, 14 warnings)`, inchangé.
- ⏳ Sevih sur le fixe : l'ordre des cartes est celui de l'éditeur de presets du jeu (favoris en tête) — sinon,
  regarder la forme réelle de `PresetOrderList` dans `user_item.json` ; le menu « Reference » / « Associated » d'une
  carte s'affiche par-dessus la carte suivante ; les chips de classe filtrent, « Sort: Class » regroupe ;
  « Optimize → » ouvre le Builder sur le héros.

### 🔧 Electron 42.4.1 → 44.9.3, installeur non publié pour le banc réel (2026-10-22)
- ✅ **Pourquoi.** La 42 n'est plus supportée depuis la sortie de la 45.0.0 le 21/10/2026 (supportées : 43, 44, 45).
  La PR #36 de Dependabot visait la 44.9.0, déjà dépassée et sans banc : elle n'est pas reprise, Sevih la fermera
  après la release.
- ✅ **Montée.** `apps/desktop/package.json` : `devDependencies.electron` `^44.9.3` et `build.electronVersion`
  `"44.9.3"` (lu par electron-builder, les deux bougent ensemble). `npm install` à la racine : le diff de
  `package-lock.json` ne touche que l'entrée `node_modules/electron` (version, `resolved`, `integrity`) et la plage du
  workspace, plus la ligne `version` du workspace desktop que le lock portait encore en 1.10.0 et que npm a
  resynchronisée sur la 1.14.0 du `package.json` (aucune dépendance). `electron-builder` 25.x, `vitest` et
  `@types/node` ne bougent pas (PR #37 et #38 hors périmètre).
- ✅ **Ruptures 43 et 44 : rien de touché.** `grep -rnE "toBitmap|showHiddenFiles|defaultPath|select-client-certificate|net\.request|isUnityRunning|clipboard|setLoginItemSettings|getLoginItemSettings|frame:|titleBarStyle|showOpenDialog|showSaveDialog|dialog\." apps/desktop/src apps/renderer/src`
  → un seul `dialog.showErrorBox` (`apps/desktop/src/main.ts:154`) et le seul `navigator.clipboard` du renderer
  (`FilterFooter.tsx`, `BuildsScreen.tsx`), plus deux commentaires ; le desktop n'importe d'`electron` que `app`,
  `BrowserWindow` et `dialog`, fenêtre avec cadre (`sandbox: true`, `nodeIntegration: false`), aucun `nativeImage`.
  Cible inchangée : `win` `nsis` x64.
- ✅ **Rien d'autre n'épinglait la 42.** `grep -rnE "42\.4\.1|electron@42"` hors `node_modules`, `release/` et lock
  → seulement les deux lignes de `apps/desktop/package.json` ; ni `docs/`, ni `wiki/`, ni le README, ni `.github/`
  ne citent de version d'Electron. `docs/release-notes.md › [Unreleased]` : une ligne « Electron 44 ».
- ✅ **Installeur non publié.** `npm run desktop:build` ; `npm run fetch-binaries -w @gear-solver/desktop` → « [ok]
  capture-steam plugin 0.4.0 (16 896 bytes) » ; `npm run dist -w @gear-solver/desktop -- --win --publish never
  '-c.artifactName=${productName} Setup ${version}-g45.${ext}'` → « packaging platform=win32 arch=x64
  electron=44.9.3 », `apps/desktop/release/Outerpedia Gear Solver Setup 1.14.0-g45.exe`, copié dans
  `~/Echanges-Claude/` (115 870 480 octets, contre 105 710 548 pour la 1.14.0). `latest.yml` et `builder-debug.yml`
  de `release/` avaient bougé : remis comme après la release 1.14.0 (non suivis par git).
- ✅ **Fumée sur le portable.** `node -e "console.log(require('electron/package.json').version)"` → `44.9.3` ;
  `npx electron --version` depuis `apps/desktop` → `v44.9.3` (premier appel : « Downloading Electron binary... »,
  la 44 télécharge le binaire au premier lancement). Piège : dans un terminal de VS Code, `ELECTRON_RUN_AS_NODE=1` est
  hérité et la commande répond la version de Node (`v24.22.0`) ; lancer avec `env -u ELECTRON_RUN_AS_NODE`.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` sans erreur (les trois workspaces) ; `npm test` →
  « Tests 166 passed (166) » (core), « Tests 196 passed (196) » (desktop), « Tests 658 passed (658) » (renderer) ;
  `npm run lint` → « ✖ 14 problems (0 errors, 14 warnings) », inchangé.
- ⏳ **Sevih, sur le fixe** : banc réel avec l'installeur `1.14.0-g45` par-dessus la 1.14.0 — lancement, Settings ›
  Setup (plugin 0.4.0 live après « Update plugin » jeu fermé), capture au lobby, déplacement d'une pièce suivi en
  direct, un enchant suivi, un solve, « Equip this build » jeu fermé ; puis, après la release 1.15.0, l'auto-update
  depuis la 1.14.0. Si un point casse, c'est la montée qui est en cause (le code est celui de la 1.14.0 + G44).
  Fermer la PR #36 après la release.

### ⬆️ Améliorations faites en jeu suivies en direct : enchant, reset, limite d'étoiles, smelting, fusion, craft, dissolution (plugin 0.4.0) (2026-10-22)
- ✅ **Pourquoi.** Demande de Sevih après la 1.14.0 : une pièce améliorée en jeu restait à +0 dans l'app jusqu'au
  lobby, et le fodder mangé restait dans l'Inventaire — le plugin 0.3.0 ne journalisait que les déplacements, les
  gemmes et les sous-stats.
- ✅ **Lecture du client** (`CWebRES_Item*.cs`, `CItemInventory.cs`). Deux formes : le `WSItemData` entier (déjà
  plié par G42) et l'entrée « simple » uid + `Quantity` (`WSItemSimpleData`, et `WSItemNormalData` qui n'y ajoute
  que `ItemID`). `UpdateSimpleData` et `UpdateItem(WSItemData)` ne lisent que l'uid et la quantité, et à 0 appellent
  `RemoveItem` (porteur déséquipé, preset nettoyé) ; à quantité positive sur un uid inconnu, ils ne créent rien —
  d'où le `skipped`. Répartition : `enchant` `Item` entier + `ItemList` simples (fodder et matériaux consommés) ;
  `enchantReset` `ResetItemData` entier (`UpdateEquipItem`) + `UseItemData` et `GetItemList` simples ; `breakLimit`
  `Item` + `ItemList` entiers (`CreateItems`) ; `smelting` / `smeltingReset` `Item` entier + `srcItem` simple ; `merge`
  `getItem` entier (`CreateItem`) + `useItem` simple (`UpdateItem`) ; `craft` `CraftItemList` entiers +
  `AdditionItem` et `MaterialItemList` simples (`UpdateItem(s)`, bien que typés `WSItemData`). **Dissolution** : le
  client n'applique PAS le `ItemList` de la réponse — `CUIItemClear`, `CUIItemSmelting` et `CUICraftingResult` retirent
  les uids de leur propre REQUÊTE (`RemoveItem` / `RemoveItemUIDs`) ; le plugin ne voyant que les réponses,
  `item/dissolve` est plié d'après son `ItemList` en entrées simples (0 = retirée, quantité positive = compteur
  réécrit) : sans risque quel que soit son contenu, mais une pièce que le serveur n'y liste pas à 0 reste jusqu'au
  lobby (dit dans l'en-tête et les docs, à confirmer sur le fil). Hors périmètre, dit dans le README du plugin :
  `item/sell` et `item/lock` (la réponse ne porte pas l'item), Custom Gear (`item/customUpdate*`), récompenses et
  monnaies.
- ✅ **Plugin — `tools/capture-steam/src/Plugin.cs`.** `Journal` gagne `/item/enchant`, `/item/enchantReset`,
  `/item/breakLimit`, `/item/smelting`, `/item/smeltingReset`, `/item/merge`, `/item/craft`, `/item/dissolve` ;
  `Plugin.Version` et `<Version>` du `.csproj` en 0.4.0. `npm run fetch-binaries -w @gear-solver/desktop` (sur le
  portable Fedora, `dotnet` présent) → « La génération a réussi. 0 Avertissement(s) 0 Erreur(s) » puis « [ok]
  capture-steam plugin 0.4.0 (16 896 bytes) ».
- ✅ **Desktop — `apps/desktop/src/equip-events.ts`.** `ITEM_UPSERTS` + `UPSERT_FIELDS` remplacés par `ITEM_FIELDS`,
  une `Map` chemin → `{ upsert: string[]; simple: string[] }` (un champ porte une entrée ou une liste) ; les quatre
  chemins de G42 y passent avec leurs seuls champs réels (`gemInsert` `Item`, `gemRemove` / `gemChangeOption` `Item` +
  `ItemGem`, `subOptionChange` `ItemData`), comportement identique. `entriesOf` aplatit les champs, `simpleOf` lit uid
  + `Quantity` (entier ≥ 0, sinon inutilisable). Pli : upserts comme avant, puis simples — `Quantity` réécrite, 0 →
  entrée retirée de la `Map` (une pièce portée qui disparaît libère son slot d'elle-même), uid absent → `skipped` ;
  une réponse sans aucune entrée utilisable compte un `skipped`. `applied` compte aussi les entrées retirées. Le rejeu
  complet reste idempotent : chaque entrée pose un état absolu, un retrait rejoué sur un snapshot déjà plié est un
  `skipped` sans effet, un retrait suivi d'un upsert du même uid remet l'entrée. Tests
  (`apps/desktop/test/equip-events.test.ts`, 10 nouveaux, helpers `subs` / `wire` / `byUid` remontés au niveau du
  module) : enchant (pièce remplacée, fodder retiré, pierres décomptées), enchantReset (pièce à +0, ticket décompté
  sans toucher ses autres champs, matériaux rendus), breakLimit (pièce + créée en fin), smelting puis smeltingReset,
  merge (créée + source à 0 retirée), craft (deux créées, matériaux et item additionnel), dissolve (retraits, dont une
  pièce portée), simples inconnus / quantité négative / réponses vides skipped, mélange avec des `item/equip` et un
  `gemInsert` (un déplacement vers le fodder déjà mangé est skipped), idempotence avec retrait puis réapparition.
- ✅ **Renderer : rien à changer.** `snapshotFollower.ts` ré-importe tout sur la mtime de `user_item.json` ; le +N
  vient de `Exp` (`levelFromExp`, `packages/core/src/parse.ts`), réécrit par l'upsert. Vu en passant : la Worklist
  garde `toName` / `toMain` figés à la mise en file (affichage seul, la valeur de main d'une ligne talisman ne suit pas
  l'enchant) ; une pièce en file ou dans un preset mangée en jeu ressort « absente » (`presetRows` la compte dans
  `missingCount`) et le `PresetList` du snapshot garde son uid jusqu'au lobby (le client l'en retire,
  `DeletePresetEquipUID`).
- ✅ **Docs.** `tools/capture-steam/README.md` (table par chemin entiers / simples, chemins exclus, table Output),
  `docs/reference.md` §1.1 + `wiki/Engine-Reference.md`, `wiki/Capture-Pipeline.md` (table Output), `wiki/FAQ.md`,
  `docs/release-notes.md › [Unreleased]`.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` sans erreur (les trois workspaces) ; `npm test` →
  « Tests 166 passed (166) » (core), « Tests 196 passed (196) » (desktop), « Tests 658 passed (658) » (renderer) ;
  `npm run lint` → « ✖ 14 problems (0 errors, 14 warnings) », inchangé.
- ⏳ **Sevih, sur le fixe (après la release)** : Settings › Setup › Update plugin jeu fermé (« plugin 0.4.0 live »),
  puis améliorer une pièce de +0 à +3 → l'Inventaire la montre à +3 dans les 5 s et la pièce fodder disparaît ; un
  smelting → sous-stats et compteur à jour ; dissoudre une pièce → elle disparaît (sinon m'envoyer
  `capture-out/equip-events.ndjson` : le `ItemList` de `item/dissolve` ne liste pas les pièces à 0 et il faudra
  journaliser la requête).

### 💎 Gemmes serties / retirées et sous-stats changées suivies en direct (plugin 0.3.0), ligne gemme de la Worklist appliquée quel que soit l'emplacement (2026-10-22)
- ✅ **Pourquoi.** Test de Sevih sur le fixe (1.13.0) : la gemme d'EE que la Worklist demandait, sertie en jeu, ne
  cochait pas la ligne. Deux causes : le plugin 0.2.0 ne journalisait que `item/equip*`, et `isChangeApplied` exigeait
  la gemme À L'INDEX de la ligne alors que `item/gemInsert` ne porte pas d'emplacement (le jeu remplit le premier libre).
- ✅ **Plugin — `tools/capture-steam/src/Plugin.cs`.** `Journal` gagne `/item/gemInsert`, `/item/gemRemove`,
  `/item/gemChangeOption`, `/item/subOptionChange` (même ligne NDJSON `{ seq, at, path, res }`, même troncature à chaque
  `/user/item`) ; `Plugin.Version` et `<Version>` du `.csproj` en 0.3.0. `npm run capture-steam:build` → « La génération
  a réussi. 0 Avertissement(s) 0 Erreur(s) » ; `npm run fetch-binaries -w @gear-solver/desktop` → « [ok] capture-steam
  plugin 0.3.0 (16 384 bytes) ».
- ✅ **Desktop — `apps/desktop/src/equip-events.ts`.** `movesOf` reste pour `item/equip*` ; nouvelle famille « item
  upsert » (`ITEM_UPSERTS`) : chaque `WSItemData` de la réponse (`Item`, `ItemGem`, `ItemData`, lus dans
  `CWebRES_ItemGemInsert` / `GemRemove` / `GemChangeOption` / `SubOptionChange`) remplace l'entrée de même `ItemUID`
  de `ItemList`, ou s'ajoute à la fin (la gemme recréée par `gemRemove`). Normalisation (`itemOf`) : uids en strings
  (le fil envoie `CharUID` 0 en nombre), `IsLock` en nombre (bool côté client ; le fil l'envoie déjà en nombre dans
  les autres réponses à `WSItemData` capturées, `item_craftConsume` et `aether_reward` d'une archive Syncthing — pas de
  vraie capture `item_gemInsert` sous la main), `SubOptionList` tel quel ; la fusion `{ ...entrée, ...item }` garde les
  champs que la réponse n'a pas (`InvenType`), et un `CharUID` absent garde le porteur du snapshot. Une réponse sans
  item utilisable est `skipped`. Le pli suit l'ordre du journal en mêlant déplacements et upserts (une `Map` par uid),
  `applied` = items réellement changés ou ajoutés (comparaison JSON), donc le rejeu complet reste idempotent. **Non
  modélisé** (dit dans l'en-tête) : la pile de gemmes que consomme `gemInsert` — le client la décrémente d'après sa
  REQUÊTE (`ItemUIDGem`), la réponse ne la porte pas ; le pool de gemmes peut compter une gemme de trop jusqu'au lobby.
  Tests (`apps/desktop/test/equip-events.test.ts`, 7 nouveaux) : insert (sous-stats changées, `CharUID`/`IsLock`/
  `InvenType` gardés, pile intacte), remove (pièce + gemme ajoutée en fin, `IsLock: true` → 1), changeOption (pièce +
  gemme), subOptionChange, mélange avec des `item/equip` dans l'ordre, idempotence (le dernier état d'un uid gagne),
  upsert d'un uid absent + réponse vide et uid hors 2^53 skipped.
- ✅ **Renderer — jugement par compte (décision de Sevih).** La règle du lot (compter les lignes de l'entrée par id)
  cochait trop tôt dans deux cas : un exemplaire déjà serti que la build garde (EE [Atk%, vide] → [Atk%, Atk%] : une
  ligne, cochée dès la mise en Worklist) et deux lignes d'un id dont la première, cochée, est retirée par
  `reconcileWorklist` (la seconde, rejugée seule, tombait à la passe suivante). Chaque ligne gemme porte donc
  `toCount` (`WorklistGemChange`, optionnel), posé par `worklistChangesFor` (`lib/worklist/changes.ts`, que le chemin
  Presets `presetWorklistFor` emprunte aussi) : exemplaires de l'id gardés par la build sur la pièce (emplacements
  qu'aucune ligne ne touche) + rang de la ligne parmi celles de cet id. `isChangeApplied` (`lib/storage/worklist.ts`) :
  pièce sur le héros ET nombre de `toGem.id` dans `gemSlots` ≥ `toCount` ; une ligne stockée sans `toCount` se range
  parmi les lignes de l'entrée (4e paramètre `lines`, passé par `reconcileWorklist`, `remainingChangeCount` et
  `changeState` via `ctx.lines`, que `WorklistScreen.tsx` remplit avec `entry.changes`). `gemIndex` ne sert plus qu'à
  l'affichage. Tests (`apps/renderer/test/worklist.test.ts`, 5 nouveaux) : `toCount` calculé, gemme au bon index / à un
  autre / absente, le cas [Atk%, vide] → [Atk%, Atk%], les deux lignes d'un id à travers deux passes de
  `reconcileWorklist`, le repli sans `toCount` (seule la première des deux lignes appliquée).
- ✅ **Docs.** `tools/capture-steam/README.md` (chemins journalisés, pile non modélisée), `docs/reference.md` §1.1 +
  `wiki/Engine-Reference.md` (et la ligne de `worklist.test.ts`, 30 tests), `wiki/Capture-Pipeline.md`,
  `docs/solver.md` (règle *applied* des lignes gemme), `wiki/Using-the-App.md`, `wiki/FAQ.md`, `docs/release-notes.md ›
  [Unreleased]`.
- ✅ **Vérification.** `npm run typecheck` → `> tsc --noEmit` sans erreur ; `npm test` → « Tests 658 passed (658) » ;
  `npm run lint` → « ✖ 14 problems (0 errors, 14 warnings) », inchangé.
- ⏳ **Sevih, sur le fixe (après la release)** : Settings › Setup › Update plugin jeu fermé (« plugin 0.3.0 live »),
  puis sertir une gemme demandée par la Worklist → la ligne se coche dans les 5 s, la retirer → la ligne revient ;
  reforger une pièce → ses sous-stats changent dans l'Inventaire sans lobby. Et m'envoyer
  `capture-out/equip-events.ndjson` après un sertissage (ou un `_unknown/item_gemInsert.json` d'un plugin 0.2.0) pour
  confirmer sur le fil la forme de `IsLock` et `CharUID` déduite des autres réponses.
- ⏳ Hors périmètre, vu en passant : la pile de gemmes consommée par `gemInsert` pourrait se modéliser si le plugin
  journalisait aussi la requête (`ItemUIDGem`) — à décider.

### 🚫 Builder › Mains : exclure une main stat par slot, à côté des acceptables (2026-10-22)
- ✅ **Pourquoi.** Le popover « Mains » n'était qu'une OR-liste d'acceptables par slot : pour écarter UNE main (ATK
  sur le Talisman, dont les mains sont partagées dans l'équipe et ne se cumulent pas — deux talismans ATK ne servent
  à rien), il fallait cocher toutes les autres, pénible et faux dès qu'une nouvelle pièce arrive.
- ✅ **Modèle — `lib/solver/builderFilters.ts`.** Champ additif `mainExcludes: Record<slot, Record<statKey, boolean>>`
  à côté de `mainPicks` (`INITIAL_FILTERS` à `{}`, passé tel quel par `buildSolveFilters`, optionnel dans le
  `SolveFilters` de `types.ts` : absent = aucune exclusion). Action `toggleMainExclude { slot, stat }` ; exclusivité
  dans les deux sens, `toggleMainPick` efface l'exclusion de la stat et `toggleMainExclude` son acceptation.
  `mergePreset` (reco) ne touche pas aux exclusions, comme demandé : une exclusion l'emporte donc sur une main que le
  reco accepte (le moteur teste l'exclusion d'abord). Sans migration : `cloneFilters` (`storage/heroFilters.ts`, qui
  sert `filtersForHero`, le snapshot de changement de héros et le chargement d'un preset) et `fromSerialized`
  (`storage/filterPresets.ts`, donc aussi un import de sauvegarde, `transfer.ts` ne faisant que fusionner les blobs
  bruts) mettent `{}` quand le champ manque.
- ✅ **Élagage — `storage/dataHash.ts`.** Le lot supposait que `pruneFilters` élaguait déjà `mainPicks` : ce n'était
  pas le cas (sets et effets seulement). `pruneFilters` élague désormais les clés de main des DEUX champs hors du
  vocabulaire du moteur, `MAIN_STAT_KEYS: Record<StatType, true>` (exhaustif vérifié par `tsc` : une stat ajoutée à
  `StatType` sans y figurer casse la compilation, donc jamais de main légitime élaguée). Une clé morte en acceptable
  vidait le slot en silence. Même objet rendu quand rien n'est mort.
- ✅ **Moteur — `allow()` de `lib/solver/engine.ts`.** Une pièce dont l'une des mains d'option (même filtre que
  l'existant : hors `combatOnly`, `source` option) est exclue pour son slot est rejetée avant le test des acceptables ;
  le rejet est compté par slot (`mainExcludedDrops`) et remonte en `poolSizes[slot].mainExcluded` (weapon, accessory,
  talisman ; champ optionnel de `PoolSizes`). Il n'existait pas de raison de pool vide par cause — l'`emptyReason` de
  `BuilderScreen.tsx` disait « Talisman: 0 pieces after filters » pour tout filtre ; il y ajoute
  « (N dropped: main stat excluded) » quand le slot vidé a perdu des pièces par exclusion.
- ✅ **UI — `screens/builder/AccessoryMainStatsPanel.tsx`.** Chaque chip cycle off → allowed → excluded → off
  (off → `toggleMainPick`, sinon `toggleMainExclude`) ; mêmes tons que les chips d'effets d'`IconChips.tsx` (cyan
  acceptée, inchangée ; rose avec pastille ✕ en bas à droite pour l'exclue, le `%` restant en bas à gauche), `title`
  qui dit l'état et le geste. Même mécanique sur les trois slots. Le hint du panneau explique les deux états et cite
  le Talisman ; le compteur du bouton « Mains » (`BuilderToolbar.tsx`) compte acceptées + exclues. Aucun autre
  changement visuel : une chip off ou acceptée rend comme avant.
- ✅ **Docs.** `docs/solver.md` + `wiki/Solver.md` (phase 2 — la puce « `g.main[0].stat ∉ picks` » décrivait mal le code,
  qui teste toutes les mains d'option, corrigée au passage ; § Main stats ; état vide), `wiki/Using-the-App.md`,
  `docs/release-notes.md › [Unreleased]`, `docs/reference.md` (élagage au changement de `hash`, ligne du nouveau test).
- ✅ **Tests.** `builderFilters.test.ts` (+6 : pose/retire, exclusivité dans les deux sens, autres stats et slots
  intacts, reco qui garde les exclusions, `cloneFilters` qui copie et filtre stocké sans le champ → `{}`) ;
  `mainExcludes.test.ts` (nouveau, 5, vrai contrat via `precomputeContext` : talisman ATK% exclu hors du pool, HP%
  reste, champ absent → pool entier, exclusion + acceptables combinés, exclusion par slot, slot vidé →
  `{ hit: 0, of: 2, mainExcluded: 2 }`) ; `dataHash.test.ts` (+2 : clé inconnue élaguée des picks et des exclusions,
  filtre sans le champ intact ; « rien de mort → même objet » étendu aux mains) ; `filterPresets.test.ts` (+2 : preset
  sans le champ → `{}`, exclusions relues telles quelles). `npm run typecheck` vert (dernière ligne « > tsc --noEmit »,
  sans erreur) ; `npm test` « Tests 166 passed (166) » core, « Tests 179 passed (179) » desktop, « Tests 653 passed
  (653) » renderer ; `npm run lint` « ✖ 14 problems (0 errors, 14 warnings) », inchangé.
- ⏳ Sevih, sur le fixe après la release : Mains › Talisman › ATK en exclu (deux clics) → plus aucun build avec un
  talisman ATK, le compteur du bouton monte ; un preset de filtres sauvegardé puis rechargé garde l'exclusion ; tout
  exclure sur un slot → la bannière nomme « main stat excluded ».

### 🩹 CI Windows : shebang retiré de `fetch-binaries.mjs` (2026-10-22)
- ✅ La CI de la release 1.13.0 (`f1120b0`) était rouge sur `windows-latest` seulement : `test/fetch-binaries.test.ts`
  importe `scripts/fetch-binaries.mjs` (G39) et le runner Windows échouait au chargement, « SyntaxError: Invalid or
  unexpected token » — la ligne `#!/usr/bin/env node` en tête du script, retirée par la transformation sur Linux, pas sur
  Windows. Le script est toujours lancé par `node scripts/fetch-binaries.mjs` (`npm run fetch-binaries`, `release.mjs`
  étape 5) : la ligne est retirée, rien d'autre ne change. `npm test` desktop « Tests 179 passed (179) », lint inchangé.

### 💎 Presets (suite) : gemmes d'EE par associé, « + Worklist » par perso du preset, priorité reprise de la build sauvegardée, groupes dans la sauvegarde (2026-10-22)
- ✅ **Pourquoi.** L'onglet Presets (G40) notait la tenue sur chaque perso avec son EE telle que sertie, ne poussait rien
  vers la Worklist, perdait les scores au relancement (priorité de session seulement) et `gs.presetHeroes` manquait à
  l'export/import. Modèle inchangé : les associés portent la tenue telle quelle, le Talisman (et ses gemmes) est DANS
  le preset, donc partagé ; chaque perso ne règle que les gemmes de SON EE.
- ✅ **Gemmes d'EE — `apps/renderer/src/lib/presets/eeGems.ts` (nouveau, pur).** `bestEeGemsFor(heroUid, presetPieces,
  ctx)` enchaîne le moteur, pièces fixées : `buildGemPool` sur un inventaire restreint à l'EE du perso et aux
  Talismans / EE que personne ne porte, hors pièces du preset — `buildGemPool` seul aurait proposé les gemmes du
  Talisman du preset quand il est libre ou porté par le perso, et celles du Talisman propre du perso (il part quand
  le preset arrive) ; `scoreGemPool` avec la priorité du perso (remplissage par `gemDmgGains` sur la tenue preset +
  EE) ; `allocateGemsCapped(scored, 0, gemSlotsOf(EE), CHC sans les gemmes d'EE)` — l'allocateur à plafond CHC du
  moteur plutôt que `allocateGems` nu, `computeScore` plafonnant CHC à 100. `alignToSockets` garde à sa place une
  gemme déjà sertie (le moins de lignes de Worklist) et laisse sa gemme à un emplacement que le choix laisse vide (le
  jeu ne retire rien seul, la Worklist non plus). Rend `{ ee }` ou `null` : pas de priorité, pas d'EE ni
  d'emplacement, pool vide, choix identique aux gemmes serties, ou score qui ne monte pas (garde-fou : l'ordre
  linéaire du score des gemmes n'est pas celui de `computeScore` composé, d'où la comparaison réelle).
- ✅ **Évaluation — `lib/presets/evaluate.ts`.** `evaluatePresetFor(…, eeGems?)` compose l'EE avec ces gemmes par le
  `gemOverride` du composeur : `eeGemOverride` y remet les subs du Talisman (le composeur saute les subs des DEUX
  pièces à gemmes sous override) et ajoute les gemmes résolues (`resolveStat`, mêmes seaux que le delta
  d'`allocateGems`). `eeOf` factorise l'EE du perso. `HeroBase.prioritySource` (`"session" | "saved"`) ;
  `heroBases` prend un `priorityOf` qui rend `{ priority, source }` ; `presetPriorityOf(sessionPriority,
  savedBuilds)` lit la session (`gs.solver.heroFilters`), puis `reforge.priority` de la build sauvegardée la plus
  récente (même `latestSavedBuild` que `bestKnownFor`), puis `null` — une priorité sans poids passe à la source
  suivante. `heroFilters.ts` et la convention de session du Builder ne bougent pas. Une persistance des filtres par
  héros en localStorage serait un autre lot, si Sevih la préfère.
- ✅ **Worklist — `lib/presets/presetWorklist.ts` (nouveau, pur).** `presetWorklistFor(heroUid, row, eeGems, inventory,
  game)` = `worklistChangesFor(diffBuildVsLoadout(pièces présentes du preset + l'EE du perso, …), { talisman: [], ee
  })` : l'EE, portée, ne fait jamais de ligne de pièce, seulement ses lignes de gemmes ; pièce absente de
  l'inventaire exclue et comptée (`missing`). `WorklistEntry.mode` passe à `WorklistMode = SolveMode | "preset"`
  (`lib/storage/worklist.ts`, `SolveMode` intact pour les builds et le solveur) et la carte de `WorklistScreen.tsx`
  affiche « Preset ». `App.tsx` : `addToWorklist(entry, note?)` (la note termine le toast « Added to / Replaced in
  worklist — <Nom> (n preset pieces not in your inventory, left out) »), passé à l'onglet Presets avec
  `worklistHeroUids`.
- ✅ **Écran — `screens/presets/PresetsScreen.tsx`.** Sur la ligne de la référence et de chaque associé (même règle
  pour la référence) : « EE gems: <noms `worklistGem`> » sous la ligne, Score et perte AVEC ces gemmes, « (<score> as
  socketed) » quand l'arrondi diffère, « priority from saved build » quand la priorité vient de la sauvegarde, bouton
  « + Worklist » (`upsertWorklistEntry` via `App`, grisé quand il n'y a rien à changer, infobulle « Replace … » quand
  le perso a déjà une entrée). Sans priorité : pas de proposition, ligne comme avant. L'écran se recharge après un
  import de sauvegarde (`onBackupImported`), sinon la modification suivante réécrivait les groupes d'avant.
- ✅ **Sauvegarde — `lib/storage/transfer.ts`.** `BackupBundle.presetHeroes` (optionnel : une sauvegarde d'avant
  s'importe sans), lu par `buildBackup`, fusionné par `applyBackup` par numéro de preset — un preset qui a déjà des
  héros ici (référence ou associé) garde les siens, comme les builds ; `ImportResult.presetGroups`, dit par le
  message d'import (`design/settings/BackupPane.tsx`, description de l'export mise à jour). **Élagage :** non branché
  — `knownRefs` (`dataHash.ts`) ne porte que des ids de sets et d'effets, ce store ne contient que des numéros de
  preset et des uids de compte, rien à élaguer.
- ✅ **Docs.** `docs/solver.md` + `wiki/Solver.md` (section « Onglet Presets » : gemmes d'EE, + Worklist, priorité ;
  carte des fichiers), `wiki/Using-the-App.md` (Presets, Worklist, Backup), `docs/architecture.md` +
  `wiki/Architecture.md`, `docs/reference.md` + `wiki/Engine-Reference.md` (carte des modules, ligne de test),
  `docs/release-notes.md › [Unreleased]` (puce Presets complétée), `docs/todo.md` (item G41 retiré).
- ✅ **Tests.** `apps/renderer/test/presetsGems.test.ts` (12 tests, table de gemmes réelle de `data/derived/`) :
  `bestEeGemsFor` ne propose jamais les gemmes du Talisman du preset (porté, puis libre), de l'EE d'un autre perso ni
  du Talisman du perso, garde à leur place les gemmes serties qui restent, `null` sans priorité et quand l'EE a déjà
  le meilleur de l'offre, score avec les gemmes proposées > tel que serti, `eeGems` = gemmes serties compose comme
  l'EE ; `alignToSockets` ; `presetWorklistFor` — pièces qui diffèrent puis lignes gemme de l'EE seules (aucune sur
  le Talisman), pièce absente exclue, porteur sans rien à régler → rien, remplacement de l'entrée existante ;
  `presetPriorityOf` — session > build sauvegardée la plus récente > `null` ; sauvegarde — aller-retour avec fusion
  (l'entrée locale gagne, une locale vide est remplacée), sauvegarde sans le champ. `npm run typecheck` : dernière
  ligne `> tsc --noEmit` (renderer, sortie 0) ; `npm test` : `Tests  638 passed (638)` (renderer ; core 166, desktop
  179) ; `npm run lint` : `✖ 14 problems (0 errors, 14 warnings)`, inchangé ; `vite build` du renderer passe
  (`PresetsScreen` 16,7 kB).
- ⏳ **Hors périmètre, repéré.** Le pool de gemmes ne tient pas compte des réservations de la Worklist
  (`worklistClaims`) : une gemme d'un Talisman libre déjà promis à un autre perso par une entrée peut être reproposée.
  Les bornes `max` des filtres du perso (`noFill` du moteur) ne sont pas lues (la priorité seule arrive à l'onglet).
- ⏳ **Sevih, sur le fixe (après la release).** Associer Ame à un preset de DLuna → « EE gems: … » et la perte
  recalculée avec ces gemmes (le score tel que serti entre parenthèses) ; « + Worklist » sur Ame → une entrée
  « Preset » avec les pièces et les gemmes d'EE ; relancer l'app → les scores restent (« priority from saved build »
  pour un perso qui a une build sauvegardée et n'a pas été rouvert dans le Builder).

### 🧩 Onglet Presets (lecture) : presets du jeu, porteurs, perso de référence et associés, score et perte par associé (2026-10-22)
- ✅ **Pourquoi.** Le jeu garde jusqu'à 30 presets d'équipement (7 pièces, l'EE n'en fait jamais partie) que l'app
  parsait déjà (`Inventory.presets`) mais ne montrait qu'en creux (le nom du preset sur une carte Builds dont la tenue
  correspond exactement). Modèle retenu : un preset = la tenue d'UN perso de référence, portée telle quelle par des
  persos associés qui se règlent par les gemmes de leur propre EE ; pas d'objectif multi-persos, on ÉVALUE la tenue
  pour chaque associé. Les groupes se font à la main (le rôle ne dit pas les besoins). Ce lot est la lecture ;
  l'optimisation des gemmes d'EE par associé et les lignes Worklist viennent après (G41, au todo).
- ✅ **Modèle — `apps/renderer/src/lib/presets/presetRows.ts`.** `presetRows(inventory)` : une ligne par preset (ordre
  du `num`), ses pièces hors EE résolues sur l'inventaire dans l'ordre weapon → talisman (`PRESET_SLOTS`), une pièce
  absente gardée et signalée (`missing`, son slot repris de la position sur le fil — Weapon, Accessory, Helmet, Armor,
  Gloves, Boots, EE, Talisman), les porteurs actuels (héros dont l'équipement hors EE est exactement le preset, index
  par signature) et les pièces présentes dans un AUTRE preset (`sharedWith`). `presetSignature` a déménagé ici depuis
  `BuildsScreen.tsx`, qui l'importe ; elle ignore en plus les slots vides (uid `0` sur le fil), sans quoi un preset
  incomplet ne correspondait jamais à personne — le nom de preset des cartes Builds suit la même règle.
- ✅ **Évaluation — `lib/presets/evaluate.ts`.** `heroBases(…)` compose chaque héros une fois sans gear (mêmes entrées
  que Builds et le Builder : `composeCharStats`, `dmgSkillInfo`, `dmgStat`/`dmgSec`/`noCrit`) avec sa priorité du
  Builder (`filtersForHero(gs.solver.heroFilters, uid, INITIAL_FILTERS).priority`, `null` si aucun poids non nul).
  `evaluatePresetFor(heroUid, presetPieces, ctx)` compose les pièces du preset + l'EE actuelle DU HÉROS (gemmes telles
  que serties ; l'EE éventuelle du slot EE du preset est ignorée) par `computeFinalStats`, dans l'ordre de l'inventaire
  (celui de Builds : un preset identique à la tenue donne exactement la même fiche), puis `computeCheapRatings` et
  `computeScore`. `bestKnownFor` = la build sauvegardée la plus récente (`createdAt`), re-notée avec la priorité
  COURANTE (pas le `score` ni la priorité de la sauvegarde), sinon la tenue actuelle ; `presetLoss` = `1 − preset /
  best`, `null` sans score ou si `best ≤ 0`.
- ✅ **Store — `lib/storage/presetHeroes.ts`.** `gs.presetHeroes` (localStorage, un blob, forme de `savedBuilds.ts`) : par
  numéro de preset `{ referenceUid, associatedUids }`. `presetHeroesFor` écarte à la lecture un uid sorti du roster (il
  reste stocké : un héros revenu d'une recapture retrouve sa place) ; un héros promu référence quitte les associés, pas
  de doublon. Le seuil d'avertissement (`DEFAULT_PRESET_LOSS_WARN` = 15) vit dans ce module léger pour ne pas tirer
  le moteur dans le bundle principal.
- ✅ **Écran — `screens/presets/PresetsScreen.tsx`.** Onglet « Presets » entre Builds et Builder (`Tab`/`TABS` et
  `TabCounts` de `design/Shell.tsx`, montage `lazy` sous `ScreenErrorBoundary` dans `App.tsx`). Une carte par preset :
  numéro, nom, ★ (core lit maintenant `Favorites` → `Preset.favorite`, `parse.ts`/`types.ts`), les 7 tuiles
  (`SlotMini` + `GearDetailBody` au survol, main stat et set sous la tuile), les porteurs (portraits), la ligne
  Reference (`HeroSelect` du Builder ; un porteur unique est proposé par défaut, « current wearer ») et la liste
  Associated (ajout par sélecteur, retrait par ✕). Pour chacun : Score, Dmg, DmgS ; pour un associé la perte en %
  « vs saved build » / « vs current gear » ; au-delà du seuil la ligne passe en orange avec « <Nom> loses 23 % vs their
  saved build » ; sans priorité « no priority set for <Nom> — set one in the Builder », pas de score. Pièces absentes
  (liseré rose, badge `missing`) et partagées (liseré ambre, badge `shared`, infobulle « Shared with #n … ») marquées
  sur la tuile et dans un bandeau de la carte ; un preset vide est listé replié. Aucune écriture vers le jeu, pas de
  Worklist. Settings → Solver : une ligne « Preset loss warning » (5–50 %, pas de 5, `gs.solver.presetLossWarn`,
  remise à 15 par « Reset solver settings »).
- ✅ **Docs.** `docs/solver.md` + `wiki/Solver.md` (section « Onglet Presets (lecture) », carte des fichiers),
  `wiki/Using-the-App.md` (six onglets, section Presets, ligne Settings → Solver) et `wiki/Home.md`,
  `docs/architecture.md` + `wiki/Architecture.md` (liste des écrans), `docs/reference.md` + `wiki/Engine-Reference.md`
  (carte des modules, ligne de test), `docs/data-schema.md` + `wiki/Data-Schema.md` (`Favorites` lu),
  `docs/release-notes.md › [Unreleased]` (puce joueur), `docs/todo.md` (item G41).
- ✅ **Tests.** `apps/renderer/test/presets.test.ts` (18 tests, héros factices sans compose) : `presetRows` — porteur
  exact malgré une autre EE dans le slot EE du preset, une pièce de différence → pas porteur, EE jamais dans le
  preset, pièce absente (slot `helmet` repris du fil), pièce partagée flaggée des deux côtés, preset vide ;
  `presetSignature` ; `evaluatePresetFor` — pièces du preset + l'EE du héros (pas celle du preset), −200 ATK d'une arme
  à ATK connu par rapport à sa tenue, `loss` à 0 quand preset = meilleure tenue, `null` sans priorité ; `bestKnownFor`
  — build sauvegardée la plus récente > tenue actuelle, score recalculé avec la priorité courante (≠ le score stocké) ;
  store — aller-retour, uid hors roster ignoré, un rôle par héros, stockage illisible. `npm run typecheck` : dernière
  ligne `> tsc --noEmit` (renderer, sortie 0) ; `npm test` : `Tests  626 passed (626)` (renderer ; core 166, desktop
  179) ; `npm run lint` : `✖ 14 problems (0 errors, 14 warnings)`, inchangé ; `vite build` du renderer passe
  (`PresetsScreen` en chunk à part, 12 kB).
- ⏳ **Limite connue — priorité de session.** La priorité par héros vient de `gs.solver.heroFilters`, en sessionStorage :
  après un relancement, un héros n'a de score qu'une fois revisité dans le Builder, et le héros ouvert dans le Builder
  n'y est écrit qu'au changement de héros. À trancher par Sevih si gênant (repli sur la priorité de la dernière build
  sauvegardée, ou mémoriser les filtres par héros en localStorage) — non fait ici, le lot fixait la source.
- ⏳ **Hors périmètre, repéré.** `gs.presetHeroes` n'est ni dans l'export/import de sauvegarde (`lib/storage/transfer.ts`)
  ni élagué au changement de données (`dataHash.ts`).
- ⏳ **Sevih, sur le fixe (après la release).** L'onglet liste ses presets avec les bons porteurs et le bon ★ (le slot vide
  est supposé valoir `0` sur le fil, aucune capture réelle sur le portable pour le confirmer) ; mettre Ame en associée
  d'un preset de DLuna (avec une priorité réglée dans le Builder pendant la session) → ligne orange avec la perte.

### 📦 Release : la DLL du plugin est recompilée et vérifiée contre `Plugin.Version` à chaque release, `dotnet` sous Linux (2026-10-22)
- ✅ **Pourquoi.** `scripts/release.mjs` (étape 5) ne lançait que `npm run desktop:build` : electron-builder embarquait
  la DLL qui traînait dans `apps/desktop/resources/capture-steam/` (dossier ignoré par git). `fetch-binaries.mjs` savait
  la reconstruire mais appelait `dotnet.exe` en dur et personne ne l'appelait. La 1.12.0, publiée depuis le portable
  (Linux) le 22/10, est ainsi partie avec la DLL du 05/09 (0.1.0, 14 848 octets) ; la prochaine doit porter la 0.2.0 de
  G37 (journal `equip-events.ndjson`), sans quoi l'app suit les déplacements en jeu mais le plugin installé ne
  journalise rien.
- ✅ **`apps/desktop/scripts/fetch-binaries.mjs`.** `dotnet.exe` sous win32, `dotnet` ailleurs (`windowsHide` gardé).
  Après la copie, `assertPluginVersion({ pluginCs, csproj, dllBytes })` (exportée, pure) lit `public const string
  Version = "…"` de `src/Plugin.cs` et `<Version>` du `.csproj`, exige leur égalité ET la présence de la chaîne dans la
  DLL posée, sinon jette avec les trois valeurs (« Plugin.Version=…, .csproj <Version>=…, DLL does not contain … »). La
  DLL réelle porte « 0.2.0 » dans les deux encodages : en UTF-8 dans les attributs d'assembly (qui viennent du seul
  `.csproj`) et en UTF-16LE dans le blob `Constant` de `Plugin.Version` ; la recherche se fait en UTF-16LE, la seule qui
  attrape un `Plugin.cs` en retard. Ligne de sortie : `[ok] capture-steam plugin 0.2.0 (16 384 bytes) -> …`. L'appel de
  `provisionSteamPlugin` / `provisionWindowsIcon` ne tourne plus que si le fichier est lancé comme script (le test
  importe la fonction sans compiler) ; types dans `fetch-binaries.d.mts`, sur le modèle de `before-pack.d.mts`.
- ✅ **`scripts/release.mjs`.** Le pré-contrôle (étape 1) lance `dotnet --version` et s'arrête net sans SDK (« dotnet not
  found on the PATH — the capture plugin can't be rebuilt », avec l'indice SDK 8+ et jeu installé). L'étape 5 lance
  `npm run fetch-binaries -w @gear-solver/desktop` AVANT `desktop:build` : un jeu absent ou une version discordante
  échoue en quelques secondes, avant le build web plus long, et toujours avant toute publication (le `catch` rend le
  bump et les journaux). L'en-tête du script (pipeline, étapes 1 et 5) le dit. `fetch-binaries` régénère aussi
  `build/icon.ico` (ignoré par git, idempotent), sans effet sur le commit de release.
- ✅ **Docs.** `docs/architecture.md` et `wiki/Architecture.md` (DLL recompilée à chaque release, refusée si sa version
  diffère de `Plugin.Version`), `tools/capture-steam/README.md` (paragraphe Packaging : appelé par `npm run release`,
  `dotnet` sous Windows comme sous Linux, monter les deux versions ensemble). `docs/release-notes.md › [Unreleased]` :
  la puce joueur de G38 (Worklist : une entrée par perso, gemmes listées, toast) à côté de celle de G37.
- ✅ **Tests.** `apps/desktop/test/fetch-binaries.test.ts` (4 tests, sans dotnet) : accord des trois → la version ;
  `Plugin.cs` ≠ `.csproj` → erreur avec les trois valeurs ; DLL qui ne porte pas la version (autre version, ou seulement
  sa copie UTF-8) → erreur ; `Plugin.Version` introuvable → erreur. Contrôle sur la vraie DLL : `assertPluginVersion`
  avec 0.1.0 la refuse (« DLL does not contain 0.1.0 »), avec les vrais `Plugin.cs` / `.csproj` rend 0.2.0. `npm run
  fetch-binaries -w @gear-solver/desktop` sur le portable : `[ok] capture-steam plugin 0.2.0 (16 384 bytes) -> …/apps/
  desktop/resources/capture-steam`. `npm run typecheck` : sortie 0 (dernière ligne `tsc --noEmit` du renderer, sans
  erreur) ; `npm test` : `Tests  608 passed (608)` (core ; desktop 21 fichiers, renderer 166 tests, tous verts) ;
  `npm run lint` : `✖ 14 problems (0 errors, 14 warnings)`, inchangé.
- ⏳ **Sevih.** La release 1.13.0 elle-même (elle embarquera la 0.2.0 recompilée) ; le pré-contrôle exige désormais
  `dotnet` dans le PATH sur le poste qui la lance. Hors périmètre, laissé : l'auto-update du plugin dans le jeu.

### 📋 Worklist : une entrée par perso (remplacement), gemmes à sertir listées, échec d'Apply par cause, toast quand l'onglet change seul (2026-10-22)
- ✅ **Pourquoi.** Retours de Sevih après G37 : deux « + Worklist » sur le même perso faisaient deux entrées (l'ancienne
  seulement marquée `superseded` slot par slot) alors qu'un build est une tenue entière ; les gemmes du build
  (`SolveBuild.gemAllocation`) n'apparaissaient pas, seules les pièces (`buildDiff`) ; l'échec d'Apply disait toujours
  « close the game » quelle que soit la cause ; et l'onglet, qui se met à jour seul depuis G37, perdait des lignes sans
  rien dire.
- ✅ **Une entrée par perso.** `upsertWorklistEntry(list, entry)` (`lib/storage/worklist.ts`, pur) : la nouvelle entrée
  en tête, celle du même `heroUid` retirée (coches comprises), les autres dans leur ordre ; `onAddToWorklist` d'`App.tsx`
  passe par elle. `loadWorklist` garde la première entrée par perso d'une liste stockée avant le lot (la liste est
  newest-first, comme l'aurait fait l'upsert), pour que le cas « deux entrées d'un perso » n'existe vraiment plus.
  `superseded` retiré de `planWorklist` (le calcul `slotOwner` par `createdAt` et le champ du plan), de `ChangeState` /
  `changeState` et de l'écran (ligne « Superseded by a newer build », prop `supersededSlots`). Le Builder reçoit
  `worklistHeroUids` (le `Set` des `heroUid` présents, mémoïsé dans App) : le bouton dit « Replace in worklist » (et son
  infobulle « one entry per hero ») quand le perso a déjà une entrée, et sa confirmation devient « Replaced ✓ »
  (`worklistAdded` passe de booléen à `"added" | "replaced" | null`).
- ✅ **Gemmes.** `WorklistChange` = `WorklistPieceChange | WorklistGemChange`, discriminées par `kind?: "gem"` (absent =
  pièce, donc les entrées déjà stockées se lisent telles quelles) ; la ligne gemme porte `slot` = slot moteur de la
  pièce porteuse (`ooparts` / `exclusive`, comme la ligne pièce, plutôt que les clés `talisman` / `ee` de
  `gemAllocation`), `gemIndex`, `toUid` / `toName` de la pièce du build, `toGem` / `fromGem` (`WorklistGem { id, name,
  stat }`, nom « Lv 3 Attack% » et stat résolus par `resolveOption` sur `game.gems`, comme `toUiPiece`). L'émission
  sort du Builder dans `lib/worklist/changes.ts` (`worklistChangesFor(diff, gemAllocation, game)`, pur) : les pièces
  comme avant, puis une ligne par emplacement où `gemAllocation[k][i]` ≠ `piece.gemSlots?.[i] ?? 0`, les 0 du build
  ignorés. `upg` reste le nombre de pièces ; le bouton « + Worklist » s'active dès qu'il y a une ligne (un build qui ne
  change qu'une gemme, `upg` 0, s'ajoute). « Appliqué » = pièce porteuse sur le perso ET `gemSlots[gemIndex] ===
  toGem.id` (`isChangeApplied`, partagé par `reconcileWorklist`, `remainingChangeCount` donc le badge, et
  `changeState`, qui reçoit `gemSlots`) ; `worklistClaims` et `planWorklist` ignorent les lignes gemme (rien à réserver,
  rien à appliquer). Rendu (`GemLine` de `WorklistScreen.tsx`) : sous la ligne de sa pièce quand l'entrée la déplace
  (`orderLines`), seule sinon avec « Talisman · gem n » et « on <pièce> » ; icône `TI_GEM_<type>_<level>` comme les
  panneaux de gemmes, nom, stat, « was <ancienne> » / « was empty », statut « socket in-game » et l'infobulle de la ligne
  « Socket in-game — Apply locally / Apply all don't socket gems. ». Apply locally ne prend que les pièces et se grise
  quand il ne reste que des gemmes. Les coches passent par `changeKey` (`slot` ou `slot:gemN`), un slot portant
  désormais plusieurs lignes.
- ✅ **Échec par cause.** `equipAssignments` rend un `EquipOutcome` comme `equipPieces` ; le tableau `FAILURE`
  d'`EquipBuildButton.tsx` sort dans `equip.ts` (`EQUIP_FAILURE`), lu par le popup du Builder, Apply all et Apply
  locally.
- ✅ **Toasts.** `design/Toast.tsx` : `createToastStore` (petit store externe, une minuterie par toast, 4 s,
  `dismiss`, `dispose`), `useToasts` (`useSyncExternalStore`, `notify` stable), `ToastStack` (pile fixe en bas à droite,
  au-dessus du pied fixe du Builder, clic = fermer) ; aucune dépendance, monté une fois dans `App.tsx`. Déclencheurs :
  l'effet d'auto-élagage compte désormais ce que `reconcileWorklist` retire (`applied: { heroUid, heroName, applied }[]`)
  et `appliedNotice` en fait UN toast par import (« Worklist: 3 changes applied — Ame, Rin ») ; il est calculé hors de
  l'updater (StrictMode le joue deux fois) depuis `worklistRef`, l'updater ne refaisant le calcul que si la liste a
  bougé entre-temps. Pas de toast après l'Apply de l'onglet lui-même (`quietReconcile`, posé par `onAfterApply`) ni
  pour une coche ; « Added to worklist — <perso> » / « Replaced in worklist — <perso> » au « + Worklist ». « Equip
  build » du Builder garde le toast quand il vide des lignes : l'onglet Worklist n'est pas à l'écran.
- ✅ **Docs.** `docs/solver.md` (paragraphe « + Worklist »), `wiki/Using-the-App.md` (« + Worklist » et section
  Worklist : une entrée par perso, gemmes, toast, échec par cause, plus de *superseded*), lignes de test de
  `docs/reference.md` / `wiki/Engine-Reference.md` (`worklistPlan` sans `superseded`, nouvelle ligne `worklist.test.ts`).
  `docs/todo.md` n'a pas d'item que ce lot clôt : inchangé.
- ✅ **Tests.** `apps/renderer/test/worklist.test.ts` (25, nouveau) : `upsertWorklistEntry` remplace par `heroUid`,
  garde l'ordre des autres et lâche les coches ; entrée stockée sans `kind` lue, comptée et planifiée comme une pièce ;
  liste stockée à deux entrées d'un perso → la première ; `worklistChangesFor` : build où seule une gemme change (`upg`
  0, une ligne), `fromGem`, 0 du build ignorés, pièces puis gemmes, rien → rien ; ligne gemme appliquée (pièce sur le
  perso + bonne gemme), pas appliquée (autre gemme ; bonne gemme mais pièce ailleurs), `remainingChangeCount` les
  compte, `worklistClaims` et `planWorklist` les ignorent, `reconcileWorklist` lâche la pièce puis la gemme et
  `appliedNotice` ; issue `ok` / `game-open` (409) / `failed` (500) / `no-snapshot` (404) pour `equipAssignments` et
  `equipPieces`, un texte distinct par cause ; toasts : apparition puis disparition à 4 s (timers factices), `dismiss` /
  `dispose` sans minuterie restante, rendu de la pile (`renderToStaticMarkup`) et rien quand elle est vide.
  `worklistPlan.test.ts` : le bloc « newest build wins » devient « plus de `superseded` » (et `equipAssignments` rend
  `"ok"`). Le message par cause de l'écran est vérifié par `EQUIP_FAILURE` et les issues, pas par un rendu de l'écran
  (pas de DOM dans les tests du renderer). `npm run typecheck` → `> tsc --noEmit` (dernière ligne, renderer), sortie
  0 ; `npm test` → core « Tests 166 passed (166) », desktop « Tests 175 passed (175) », renderer « Tests 608 passed
  (608) » ; `npm run lint` → « ✖ 14 problems (0 errors, 14 warnings) » : un de moins que les 15 attendus, le
  `react-hooks/set-state-in-effect` de l'effet d'auto-élagage d'`App.tsx` (son `setWorklist` vient maintenant après un
  retour anticipé), aucun `eslint-disable` ajouté.
- ⏳ **Sevih, sur le fixe** : solve d'un perso déjà en Worklist → le bouton dit « Replace in worklist », un clic →
  « Replaced ✓ », toast « Replaced in worklist — <perso> », une seule entrée dans l'onglet ; un build qui ne change
  qu'une gemme du Talisman / de l'EE → « + Worklist » actif, une ligne gemme (icône, stat, « was … ») ; jeu ouvert,
  déplacer en jeu une pièce de l'entrée → dans les 5 s la ligne part et un toast « Worklist: 1 change applied — <perso> »
  s'affiche en bas à droite ; sertir la gemme en jeu → la ligne gemme part au retour au lobby (le journal G37 ne suit que
  les déplacements de pièces). Apply locally jeu ouvert → le message « The game is open… » sur la carte.
- ⏳ **Hors périmètre, repéré** : `docs/release-notes.md › [Unreleased]` n'a pas de puce pour ce lot (à écrire avec la
  release) ; les totaux de tests de `docs/reference.md` / `wiki/Engine-Reference.md` (« Total : 300 tests ») étaient
  déjà faux avant ce lot.

### 🔄 Le snapshot suit les déplacements de pièces faits en jeu (journal `item/equip` du plugin 0.2.0, plié par le desktop), sans repasser par le lobby (2026-10-22)
- ✅ **Pourquoi.** Le jeu n'envoie `/user/item` qu'au lobby : une pièce déplacée dans l'écran du héros n'atteignait le
  snapshot qu'au retour au lobby, et l'Equip local était refusé (409) tant que le jeu tournait. Or chaque déplacement
  répond `/item/equip` (`CWebRES_ItemEquip` : `CharUID`, `UnEquipCharUID`, `ToEquipUID`, `ToInvenUID`) ou
  `/item/equipAll` (`CWebRES_ItemEquipAll` : `CharUID`, `ToEquipList`, `ToInvenList`, `UnEquipList` de
  `{ CharUID, ItemUID }`), que le hook `Log2InternalWeb` voyait déjà mais rangeait dans `_unknown/`.
- ✅ **Plugin** (`tools/capture-steam/src/Plugin.cs`, `Version` et `<Version>` du `.csproj` 0.1.0 → 0.2.0). Table
  `Journal` (`/item/equip`, `/item/equipAll`) à côté de `Want`, testée avant elle dans `Capture` (donc `KeepUnknown` ne
  s'applique plus à ces deux chemins) : `AppendJournal`, sur le thread d'écriture unique, ajoute à
  `equip-events.ndjson` une ligne `{"seq":n,"at":ISO UTC,"path":…,"res":<réponse telle quelle>}` (`seq` monotone
  depuis le démarrage du jeu ; la réponse n'est re-sérialisée via `JToken` que si elle contenait un retour à la ligne),
  puis heartbeat et log comme une capture. `WriteKnown("user_item")` tronque le journal AVANT d'écrire le snapshot
  (`TruncateJournal`), y compris par le fallback de forme ; ce fallback n'a pas de chemin, il ne journalise donc pas
  (sans hook primaire, les déplacements attendent toujours le lobby — dit dans le README). `npm run
  capture-steam:build` : « La génération a réussi. 0 Avertissement(s) 0 Erreur(s) », `dist/GearSolverCapture.dll` =
  16 384 octets (la chaîne `0.2.0` et `equip-events.ndjson` y sont).
- ✅ **Desktop** (`apps/desktop/src/equip-events.ts`, nouveau). `foldEquipEvents(raw, events) → { next, applied,
  skipped }`, pur : par uid seulement (`item/equip` : `ToInvenUID` ≠ 0 → `"0"`, puis `ToEquipUID` ≠ 0 →
  `String(CharUID)`, le vol à un autre perso est couvert puisque la pièce volée EST `ToEquipUID` ; `item/equipAll` :
  `UnEquipList[].ItemUID` puis `ToInvenList[]` → `"0"`, puis `ToEquipList[]` → `CharUID`, l'ordre de
  `CItemInventory.UpdateEquipItems`) ; `applied` = pièces dont le propriétaire a réellement changé, `skipped` = uid
  absent du snapshot (pièce obtenue après lui, jamais inventée) ou illisible, jamais une erreur ; autres clés
  copiées, entrée intacte. **Uids** : vérifiés sur la vraie capture (`user_item` du 07/09, 1 279 entrées, uids en
  strings, max 6 134 942 991 ≪ 2^53 ; les vraies réponses `item_equip`/`item_equipAll` de `_unknown/` portent aussi
  des strings, ex. `"ToEquipUID":"6124885095"`) : le JSON du jeu est déjà en texte, `JSON.parse` ne perd rien ; un
  nombre n'est accepté que s'il est un entier sûr (sinon `skipped`), et le snapshot fait un aller-retour
  `JSON.parse`/`stringify` octet pour octet. `parseEquipJournal` ne lit que les lignes complètes (le plugin peut être
  en plein append) et écarte les lignes illisibles. `createEquipJournalFollower(captureOut)` : `sync()` branché en tête
  de `captureStatus` dans `createApiHandler` (le tic de 5 s du renderer, prod comme middleware Vite), erreurs en
  `dwarn` ; `dlog("capture", …)` donne la plage de `seq`, le compte plié et le compte sauté.
- ✅ **Règle de troncature — écart assumé avec la lettre du lot.** « premier `seq` du fichier ≤ dernier appliqué →
  repartir de zéro » est vrai à CHAQUE tic dans une session normale (fichier `1..n`, dernier appliqué `k ≥ 1`), et une
  troncature au lobby continue la numérotation (`n+1…`) sans jamais repasser sous `k` ; à l'inverse un redémarrage du
  jeu repart à `seq` 1 et serait ignoré. Ce qui rend le problème simple : chaque événement pose des propriétaires
  ABSOLUS, donc rejouer TOUT le journal sur un snapshot qui en contient déjà une partie donne le même état (testé).
  Le suiveur note donc dans `.equip-events.applied` (et en mémoire) `{ first, last, mtime }` — premier et dernier `seq`
  du journal plié et mtime du `user_item.json` qu'il a laissé — et rejoue tout le journal dès que l'un des trois
  change : nouvelle ligne, journal tronqué ou nouvelle session (premier `seq` différent), snapshot remplacé dessous
  (un `/user/item`, même si le tic a raté le journal vide). Journal vide → repère remis à zéro, rien d'écrit. Le
  journal est lu AVANT le snapshot (le plugin tronque avant de réécrire). `writeAtomic` seulement si `applied > 0`,
  donc un second GET sans nouvel événement n'écrit rien. Le `POST /api/captured/user-item` (jeu fermé) appelle
  `noteSnapshotWritten()` après écriture, pour que l'édition locale ne soit pas recouverte par un rejeu du vieux
  journal.
- ✅ **409 et popup.** Le refus du POST quand le plugin est live dit maintenant « The game is open: the app now
  follows in-game moves by itself; close it to apply a local-only edit » (le 409 du wipe garde le sien).
  `apps/renderer/src/equip.ts` : `EquipOutcome = "ok" | "no-snapshot" | "game-open" | "failed"`, `writeUserItem`
  distingue le 409, `equipPieces` rend la raison ; `equipAssignments` reste booléen (`=== "ok"`). `BuilderScreen.tsx`
  relaie l'issue, `EquipBuildButton.tsx` affiche un texte par raison (`FAILURE` : le 409 reprend le message serveur,
  `no-snapshot` = « Couldn't read the captured snapshot. Capture again (reach the lobby) or re-import it, then retry. »).
  `WorklistScreen.tsx` : seulement `=== "ok"` sur l'appel à `equipPieces`.
- ✅ **Worklist vérifiée, non touchée.** « applied » se dérive bien de l'inventaire courant (`changeState` →
  `equippedOnHero`, cf. en-tête de `lib/storage/worklist.ts` : `done` n'est que la coche manuelle cosmétique) : la
  mtime de `user_item.json` bouge, `snapshotFollower` réimporte, la ligne passe « applied » d'elle-même.
- ✅ **Docs.** `tools/capture-steam/README.md` (paragraphe journal sous les hooks, deux lignes `equip-events.ndjson` /
  `.equip-events.applied` dans Output, `KeepUnknown` hors chemins journalisés), `docs/reference.md` §1.1 + §1.7 et
  leur miroir `wiki/Engine-Reference.md`, `wiki/Capture-Pipeline.md` (table Output), `wiki/FAQ.md` (« only edit the
  local snapshot » : jeu fermé ; jeu ouvert, l'app suit seule), `docs/release-notes.md › [Unreleased]` (puce joueur ;
  le chemin réel est Settings › Setup › **Update plugin**, il n'y a pas d'onglet « Steam »), `docs/todo.md` (item
  Equip / Unequip).
- ✅ **Tests.** `apps/desktop/test/equip-events.test.ts` (15) : pose simple, échange, retrait, vol (`UnEquipCharUID`),
  `equipAll` aux trois listes, uid inconnu → `skipped`, id numérique sûr/non sûr, idempotence, clés gardées et entrée
  intacte, lignes déchirées/illisibles ; suiveur : plie une fois puis reste inerte, survit à un redémarrage de l'app,
  troncature → repart de zéro, nouvelle session à `seq` 1, pas de rejeu sur l'écriture de l'app.
  `api-handler.test.ts` : un `GET /api/capture/status` avec un journal réécrit `user_item.json` (mtime rendue = mtime
  du fichier, contenu plié), un second GET ne bouge rien ; `server-writeback.test.ts` : le 409 porte le nouveau
  message. `npm run typecheck` → `> tsc --noEmit` (dernière ligne, renderer), sortie 0 ; `npm test` → core « Tests
  166 passed (166) », desktop « Tests 175 passed (175) », renderer « Tests 586 passed (586) » ; `npm run lint` →
  « ✖ 15 problems (0 errors, 15 warnings) », inchangé.
- ✅ **Installeur sans publication.** `npm run build` (core + renderer), plus `npm run build -w @gear-solver/desktop`
  (le `build` racine ne compile pas le desktop) et la DLL 0.2.0 recopiée à la main dans
  `apps/desktop/resources/capture-steam/` (ce que fait `fetch-binaries.mjs`, qui appelle `dotnet.exe` et ne tourne pas
  sous Linux ; la DLL qui y dormait datait du 05/09, 14 848 octets). `npm run dist -w @gear-solver/desktop` seul
  viserait Linux : lancé avec `-- --win --publish never '-c.artifactName=${productName} Setup ${version}-g37.${ext}'`
  pour ne pas écraser l'exe 1.12.0 publié → `apps/desktop/release/Outerpedia Gear Solver Setup 1.12.0-g37.exe`,
  105 698 097 octets (`win-unpacked` contient la DLL de 16 384 octets et `dist/equip-events.js`) ; `latest.yml` et
  `builder-debug.yml` remis comme après la release 1.12.0. Non copié ailleurs.
- ⏳ **Sevih, sur le fixe** : installer `Outerpedia Gear Solver Setup 1.12.0-g37.exe` par-dessus la 1.12.0 ; jeu
  fermé, Settings › Setup › **Update plugin** (le statut doit lire « plugin 0.2.0 live » une fois le jeu lancé) ;
  lancer le jeu, atteindre le lobby, déplacer une pièce : dans les 5 s l'app la montre sur le nouveau perso et la
  ligne Worklist correspondante passe « applied » ; `equip-events.ndjson` grandit à chaque déplacement et se vide au
  retour au lobby. À essayer aussi : un « équiper tout » (`equipAll`) et un vol de pièce à un autre perso.
- ⏳ **Hors périmètre, repéré** : le message d'échec de la Worklist (« Apply failed — close the game while the Steam
  plugin is live, then retry. ») ne dit pas encore que le jeu ouvert suffit ; `fetch-binaries.mjs` n'a pas de chemin
  Linux (`dotnet.exe` en dur) ; la release suivante devra passer le plugin dans le même mouvement (sinon l'app suit
  mais le plugin 0.1.0 installé ne journalise rien).

### ⚔️ Colonnes par tour (DmgS / McdS) sur la rotation par cooldowns du contrat, le meilleur hit reste pour Dmg / Mcd (2026-10-22)
- ✅ **Pourquoi.** `dmgs`/`mcds` = dégât × SPD, « par tour », multipliaient le hit du MEILLEUR skill comme si le perso
  le relançait à chaque tour ; les tables synchronisées au commit `60963bb` (hash `1f7fe7bd57b6`, format 2) portent
  sur les 129 persos le champ additif `rotation: { factorPerTurn (‰), cycle, uses: { S1, S2, S3 }, approx? }` à côté
  de `bestSkill` : la moyenne par tour du facteur joué quand le perso lance à chaque tour le skill prêt le plus fort
  (S3 > S2 > S1, cooldowns `Cool`/`StartCool` du jeu, sans burst, AP ni DoT ; 4 persos `approx`).
- ✅ **Quoi.** `CharacterDef.rotation?` typé dans `packages/core/src/gamedata.ts` (docblock : origine, sens, optionnel
  → repli sur `bestSkill`, jamais une erreur ; celui de `bestSkill` dit maintenant qu'il ne fait plus que `dmg`/`mcd`).
  `apps/renderer/src/lib/dmgSkill.ts` : `dmgSkillFactor(best)` inchangé (per-hit) ; nouvelle
  `turnSkillFactor(rotation, best)` = `factorPerTurn / 1000`, repli `dmgSkillFactor(best)` sans rotation (ou
  `factorPerTurn <= 0`) ; `dmgSkillInfo(best, rotation?)` gagne `turn: { factor, label, missing, approx }`, label
  « S3 ×1, S2 ×2, S1 ×1 over 4 turns » (skills à 0 lancer omis), `missing` = repli sur le meilleur skill (label et
  `approx` du meilleur skill alors). `ratings.ts` : `computeCheapRatings(…, skillFactor, turnFactor = skillFactor)`,
  `turnFactor` appliqué au même endroit que `skillFactor` (après base × taux crit/dmgUp × PEN) sur `dmgs`/`mcds`,
  `skillFactor` reste sur `dmg`/`mcd`, `dmgh` intouché. `engine.ts` : `SolveContext.turnFactor`
  (`turnSkillFactor(meta.rotation, meta.bestSkill)`), passé aux deux appels de `computeCheapRatings` (chunk et
  `finalizeBuilds`) ; les workers reçoivent le contexte tel quel, aucun autre appelant dans `apps/renderer/src`.
  `BuilderScreen.tsx` passe `meta.rotation` à `dmgSkillInfo`.
- ✅ **UI.** Seules les infobulles changent : `statColumns.ts`, DmgS/McdS (formule `… × turnFactor × SPD`, desc
  « average skill factor per turn (S3/S2/S1 rotation by cooldowns) ») et `ratingTitle` qui ajoute « × average factor
  per turn (S3/S2/S1 rotation by cooldowns): S3 ×1, S2 ×2, S1 ×1 over 4 turns ×1.74 » plus « approx » quand
  `rotation.approx`, ou « ⚠ No rotation in this data snapshot — best skill used instead » sur un vieux cache ;
  Dmg/Mcd gardent « Best skill: … ». Le badge d'en-tête (le skill gagnant, `ResultsTable.tsx`) est inchangé, y compris
  sur DmgS.
- ✅ **Classement mono-perso inchangé** : les deux facteurs sont des constantes par perso, l'ordre des builds d'un
  solve ne bouge pas (test dédié) ; seuls les nombres DmgS/McdS affichés et la comparaison entre persos changent.
- ✅ **Vraie donnée.** Tamamo-no-Mae (`2000080`) : `turnSkillFactor` = 1,735 (S1 ×1, S2 ×2, S3 ×1 sur 4 tours) <
  `dmgSkillFactor` = 2,004 (S2) ; sa variante Kitsune of Eternity (`2000086`) : 1,843 < 2,490 (S3).
- ✅ **Tests legacy réparés** (`packages/core/test/compose-stats.test.ts`, describe « Core Fusion — fallback on a cache
  without corePassiveByFusion (legacy corePassive) ») : rouges depuis `60963bb` (ils retiraient `corePassiveByFusion`
  de la vraie donnée et attendaient un `corePassive` que le format 2 ne porte plus). Le cache legacy se construit
  désormais à la main depuis le bloc `corePassiveByFusion["5"]` du perso, sans `spdPct`, avec la vitesse cuite en plat
  de l'ancien encodage (Snow `spd` 6, Notia 0 — son `effRate` 50 donne EFF 255 à tout palier) ; valeurs épinglées
  inchangées (Snow 139 / 142 / 145 / 148 / 155 / 163, Notia EFF 255 à la fusion 1). Commentaire : la donnée n'a plus
  `corePassive` depuis le format 2 (22/10/2026), ces tests ne couvrent que le repli des vieux caches. Compositeur et
  donnée intouchés.
- ✅ **Tests.** `apps/renderer/test/dmgSkill.test.ts` : facteur par tour avec rotation, repli sans (`undefined`,
  `null`, `factorPerTurn` 0, ni l'un ni l'autre → 1), `approx`, label, infobulles DmgS/McdS vs Dmg/Mcd, vraie donnée
  (toutes les entrées ont une rotation, Tamamo 1,735 < 2,004). `apps/renderer/test/solver.test.ts` (describe
  `computeCheapRatings`, pas de `ratings.test.ts` dans le dépôt) : `dmgs`/`mcds` suivent `turnFactor`, `dmg`/`mcd`
  `skillFactor`, `turnFactor` par défaut = `skillFactor`, ordre de 4 builds identique pour toute paire de facteurs
  positifs. Les littéraux `SolveContext` de `dominance`, `sheetMinors`, `solveChunk` et `solveChunkCritCap` gagnent
  `turnFactor: 1`. `npm run typecheck` : sortie 0 (dernière ligne `tsc --noEmit`) ; `npm test` : core
  `Tests 166 passed (166)`, desktop `Tests 159 passed (159)`, renderer `Tests 586 passed (586)` ; `npm run lint` :
  `✖ 15 problems (0 errors, 15 warnings)`, inchangé.
- ✅ **Docs.** `docs/data-schema.md` + `wiki/Data-Schema.md` (paragraphe « Facteurs de skill » : `bestSkill` et
  `rotation`), `docs/reference.md` + `wiki/Engine-Reference.md` §2.3 (`turnFactor` dans le bloc de formules, lignes
  `dmgs`/`mcds` du tableau, paragraphe « Rotation par cooldowns », le « TODO » retiré), `docs/solver.md` +
  `wiki/Solver.md` (étape 3), `docs/release-notes.md › [Unreleased]` (puce joueur), `docs/todo.md` (item « DPS de
  rotation pondéré par les cooldowns » retiré).
- ⏳ **Laissé.** Bursts, AP et DoT dans la rotation (l'item « DoT dans le meilleur hit » reste au todo) ; le badge
  d'en-tête de DmgS montre toujours le skill gagnant (changement visuel non demandé) ; la release.

### 🧪 Contrat solver, M3 — le passif d'EE de Fatal (`ee-passives["2000078"]`) lu par un test, garde-fou de contrat (2026-10-21)
- ✅ **Pourquoi.** `packages/core/src/parse.ts` (l.282-300) lit `game.eePassives?.[String(item.ItemID)]` pour un item
  `exclusive`, saute une entrée tant que `enhanceLevel < levelThreshold` (`levelThreshold <= 1` = toujours active) et
  pousse un main `fromBuff: true`, `source: "eePassive"` par `resolveOption(ep, 1)`. Cette lecture n'est juste que si
  la clé du contrat est bien l'id d'item de l'EE : c'est le cas, les EE portent l'id de leur perso (`2000078` est à la
  fois Fatal dans `characters.json` et son EE « Eclipse » dans `equipment.json`, `2000072` Edelweiss, `2000008` Rhona).
  Rien ne gardait le contrat lui-même : un id de perso divergent de l'id d'EE côté outerpedia aurait éteint le passif
  sans bruit.
- ✅ **Quoi.** `packages/core/test/ee-passive.test.ts` (nouveau, 4 tests), sur le modèle de `unique-passive.test.ts`
  (`readFileSync` de `data/derived/`, `options`, `equipment`, `enhance` et `eePassives` réels, helper `item(ItemID,
  level)` qui fixe `Exp` au bas du niveau voulu sur la courbe de l'item, `enhance.expCurves["slot|grade|star"]`, et
  vérifie que `parseGearPiece` relit bien ce niveau) : (1) Eclipse de Fatal à +0 → aucun main `eePassive` ;
  (2) à +10 → `{ stat: "critDmg", value: 30, percent: true, fromBuff: true, source: "eePassive" }` (contrat
  `[{ levelThreshold: 10, st: "ST_CRITICAL_DMG_RATE", ap: "OAT_ADD", v: 300 }]`, `ST_CRITICAL_DMG_RATE` en `OAT_ADD`
  est un % : 300 ÷ 10 = 30) ; (3) entrée toujours active : l'EE d'Edelweiss `2000072`,
  `[{ levelThreshold: 1, st: "ST_HP", ap: "OAT_RATE", v: 350 }]` → `hpPct` 35 % `fromBuff` à +0 comme à +10 ;
  (4) garde-fou : chacune des 35 clés de `ee-passives.json` est un item `slot: "exclusive"` d'`equipment.json`, et
  chaque entrée porte `st`/`ap` en chaînes, `v`/`levelThreshold` numériques — passe sur la donnée du jour (seuils
  présents : 1 et 10), aucune clé à remonter à outerpedia. Aucun code de l'app touché.
- ✅ **Recouvrement.** `parse.test.ts` avait déjà un bloc « EE level-gated passive — Fatal's Eclipse » sur la vraie
  donnée (contrat égal, +9 sans main, +10 CHD 30 % par `parseInventory`) : laissé tel quel, hors périmètre ; le nouveau
  fichier ajoute le +0, l'entrée `levelThreshold: 1` et le garde-fou de contrat. `docs/reference.md` : une ligne
  `ee-passive.test.ts` au tableau des tests (§ 3.3) ; le total du paragraphe « Run » y était déjà en retard, non
  repris. `docs/todo.md` non touché : `M3` n'y figure que dans la note « Dernier passage » (déjà sorti le 19/10),
  aucun item `ee-passives`.
- ✅ **Vérifié.** `npm run typecheck` : `tsc --noEmit` sans erreur sur les trois workspaces (renderer en dernier).
  `npm test` : core `Tests  166 passed (166)` (11 fichiers), desktop `Tests  159 passed (159)`, renderer
  `Tests  579 passed (579)` (dernière ligne).
- ⏳ Rien pour Sevih côté app (pas de note de release, rien pour le joueur). Le point (a) de « Contrat solver — ce qui
  reste » est retiré du `docs/TODO.md` d'outerpedia.

### 🔄 CI — `data-sync.yml` : synchro quotidienne des tables depuis outerpedia en PR, typecheck et tests avant ouverture (2026-10-20)
- ✅ **Pourquoi.** `npm run data:sync` était un geste manuel après chaque patch : tant qu'il n'était pas joué,
  `data/derived/` et `apps/desktop/src/game-client.json` (ce qui part dans l'installeur) restaient en retard sur
  outerpedia (le 20/10, un `chore(data)` à la main avant la release 1.11.1). L'app en mode REPO suivait déjà
  seule (`data-sync.ts`) : rien n'y change, ni dans `data/sync.mjs` ni dans `scripts/release.mjs` (qui garde sa
  propre synchro à l'étape 3).
- ✅ **Quoi.** `.github/workflows/data-sync.yml` (nouveau) : `schedule` `cron: '0 9 * * *'` (09:00 UTC, les patchs
  tombent le mardi matin UTC) + `workflow_dispatch` ; `permissions: contents: write, pull-requests: write` ;
  `concurrency: data-sync` sans annulation (un run manuel attend le quotidien). Un job `ubuntu-latest`,
  `ELECTRON_SKIP_BINARY_DOWNLOAD: "1"`, `shell: bash` explicite (donc `-eo pipefail` : un `sync.mjs` en échec fait
  échouer son `| tee`). Étapes : checkout de gear-solver et checkout de `Sevih/outerpedia` (public, aucun secret,
  `persist-credentials: false`) dans `path: outerpedia`, `fetch-depth: 1`, `sparse-checkout` limité à
  `/data/generated/solver/` et `/data/curated/game-client.json` avec `sparse-checkout-cone-mode: false` (le mode
  cône ne prend que des dossiers, vérifié dans l'`action.yml` de `actions/checkout` v4.4.0) ; setup-node 22 ;
  `npm ci` ; `OUTERPEDIA_PATH="$GITHUB_WORKSPACE/outerpedia" node data/sync.mjs | tee` ; si
  `git diff --quiet -- data/derived apps/desktop/src/game-client.json` → « up to date » au résumé, succès ; sinon
  branche `data-sync/<resVersion>-<7 premiers caractères du hash>` lue dans `data/derived/version.json` ;
  `npm run typecheck` puis `npm test` (ce dernier avec `OUTERPEDIA_PATH`, si bien que `game-client.test.ts` et
  `contractShape.test.ts`, sautés par `ci.yml` faute de checkout, tournent aussi) — un échec laisse le run rouge et
  n'ouvre rien ; enfin commit `chore(data): tables <resVersion> (<hash>) from outerpedia <sha court>` par
  `github-actions[bot]`, `git add data/derived apps/desktop/src/game-client.json` seuls, push de la branche,
  `gh pr create` (`GH_TOKEN: ${{ github.token }}`) titré `chore(data): tables <resVersion> from outerpedia`, corps =
  sortie de `sync.mjs` + `git diff --stat` + la ligne `client` avant/après de `game-client.json` quand elle
  change. Les `${{ … }}` passent par des `env:`, jamais dans le texte des scripts. Mêmes SHA que `ci.yml`
  (`grep -n "uses:" .github/workflows/*.yml` : checkout `11d5960a…` partout, setup-node `49933ea5…`), forme
  `@<sha> # v4.4.0` que suit `dependabot.yml`.
- ✅ **PR déjà ouverte : le choix le plus simple à lire.** (1) Mêmes tables qu'une branche `data-sync/…` déjà
  poussée (`git ls-remote --exit-code --heads origin <branche>`, PR encore ouverte ou fermée à la main) : résumé
  « already proposed », succès, ni typecheck ni PR — pas de nouvelle PR identique chaque matin. (2) Tables
  nouvelles : la nouvelle PR s'ouvre, PUIS chaque autre PR ouverte dont la tête commence par `data-sync/` est
  fermée par `gh pr close --delete-branch` avec un commentaire « Superseded by … » : seule la plus récente reste
  proposée, et rien n'est fermé si l'ouverture a échoué.
- ✅ **Docs.** `data/README.md` (schéma et puce `sync.mjs`), `docs/architecture.md` (phrase `game-client.json` et
  paragraphe Packaging) + `wiki/Architecture.md` (même paragraphe), `docs/STATUS.md` (puce `data/derived/`, aucune
  phrase CI n'y figurait) disent que la synchro tourne aussi chaque jour par `data-sync.yml` en PR. Rien dans
  `docs/release-notes.md` (rien pour le joueur). `docs/todo.md` non touché : aucun item n'y parle de la synchro
  manuelle après un patch (grep `data:sync`, `sync`, `patch` : seul « Vérif sync repo en prod packagé », qui vise
  la synchro de l'app).
- ✅ **Vérifié.** `actionlint` absent : parse par `js-yaml` (dans `node_modules`) — clés `name, on, permissions,
  concurrency, jobs`, `on` = `{"schedule":[{"cron":"0 9 * * *"}],"workflow_dispatch":null}`, 8 étapes. **Rejeu
  local** dans une copie `cp -a` du dépôt (scratchpad sous `/tmp`, jamais ce checkout), `origin` repointé sur un
  clone nu local, `outerpedia` = lien vers le vrai checkout, `gh` remplacé par un `echo` sur le `PATH` ; chaque bloc
  `run:` extrait du YAML et joué par `bash --noprofile --norc -eo pipefail` avec `GITHUB_WORKSPACE`,
  `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`, `RUNNER_TEMP`. (a) À jour (tables du 20/10) : `changed=false`, résumé
  « Tables up to date with outerpedia `16369827`: nothing to propose. », sortie 0, aucun commit. (b) Diff : un
  octet de `data/derived/sets.json` et `"version": "1.4.18"` dans `game-client.json` COMMITÉS dans la copie (un
  octet non commité serait simplement réécrit par `sync.mjs`) → `changed=true`, `branch=data-sync/1.11.500-36a57d7`,
  typecheck vert, `Tests  579 passed (579)` (aucun sauté avec `OUTERPEDIA_PATH`, contre `578 passed | 1 skipped`
  sans), commit `de407cf github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>
  chore(data): tables 1.11.500 (36a57d7fdbc9) from outerpedia 16369827` (2 fichiers), branche poussée sur le clone
  nu, `[gh stub] gh pr create --base main --head data-sync/1.11.500-36a57d7 --title chore(data): tables 1.11.500
  from outerpedia --body-file …`, corps avec la ligne `client` `{"version":"1.4.18",…}` → `{"version":"1.4.19",…}`.
  (c) Même état rejoué : « Tables 1.11.500 (36a57d7fdbc9) already proposed on `data-sync/1.11.500-36a57d7`. »,
  sortie 0. (d) Checkout vide : « no outerpedia checkout with data/generated/solver found … », étape en échec.
  Dans ce dépôt : `npm run typecheck` → `> tsc --noEmit` (sortie 0) ; `npm test` → `Tests  162 passed (162)`,
  `Tests  159 passed (159)`, `Tests  579 passed (579)`.
- ⏳ Sevih : activer « Allow GitHub Actions to create and approve pull requests » (Settings › Actions › General ;
  `can_approve_pull_request_reviews: false` aujourd'hui), sans quoi `gh pr create` échoue. Après le push, lancer une
  fois `gh workflow run data-sync.yml` pour voir le cas « up to date ». La première vraie PR arrivera au prochain
  patch ; comme elle vient de `GITHUB_TOKEN`, `ci.yml` ne s'y lance pas (le run a déjà joué typecheck et tests sur
  Linux, pas sur Windows ni le lint).

### 🧹 Renderer — restes de G15 à G29 et F28 : lint 28 → 15, Builder réveillé par l'élagage, statut dans Settings, pièce réservée non « libre », `upg` vivant, pré-tri Score, pastille combat, test img-cache stabilisé (2026-10-19)
- ✅ **Pourquoi.** Lot de clôture du renderer (G32), après G31 et G33 : sept restes notés par G15 à G29 et F28 dans
  leurs entrées, rien de nouveau. Chaque point est un changement minimal ; un seul changement visuel (le pied de
  Settings).
- ✅ **(1) Lint sans changement de comportement — `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)` avant,
  `✖ 15 problems (0 errors, 15 warnings)` après** (attendu 16 : un de moins, voir `usePersistedState`). `App.tsx` :
  directive `eslint-disable-next-line react-hooks/exhaustive-deps` inutile retirée (effet de `waitForStartupSync`) ;
  `refreshRef.current = refreshInventory` passé dans un `useEffect` sans tableau (après le rendu, déclaré avant
  l'effet `follower.init()` qui le lit) ; le suiveur créé par `useState(() => createSnapshotFollower({ … }))`
  (initialisation paresseuse, lue sans `.current`, import du type `SnapshotFollower` devenu inutile retiré) ;
  `builderMounted` passé en `useState(false)` mis à `true` par un effet sur `tab` (le Builder se monte un rendu plus
  tard la toute première fois, même écran). `useClickOutside.ts` : `cb.current = onOutside` dans un `useEffect` sans
  tableau. `usePersistedState.ts` : `codecRef.current = codec` dans un `useEffect` sans tableau (déclaré avant
  l'effet de persistance qui le lit), `storeRef.current ??= pick()` → `const [store] = useState(pick)` (ajouté aux
  dépendances de l'effet de persistance, identité stable) ; l'initialiseur de la valeur lisait `codecRef.current`
  au rendu, ce que le compilateur signale une fois l'écriture sortie : il lit `codec` directement (même objet au
  premier rendu, seul moment où l'initialiseur tourne). `SortHeader.tsx` : `Th` sorti du rendu en composant de
  module (`sort`, `dir`, `onSort` en props, même JSX). `BuildsScreen.tsx` : `lockedKeys` en
  `useMemo(…, [locked])`. **Ce qui ne tombe pas entièrement** : le correctif (b) du suiveur fait passer `App.tsx`
  de 5 avertissements `react-hooks/refs` (l.234 et 4 × l.243) à UN (`App.tsx:235`, « Passing a ref to a function
  may read its value during render » sur l'initialiseur de `useState`, qui reçoit la flèche
  `(label) => refreshRef.current(label)`) ; une flèche locale dans l'initialiseur et un `useCallback` extérieur ont
  été essayés, même avertissement : la forme du lot est gardée (net −4), aucune directive ajoutée. Le correctif (c)
  ajoute, comme prévu, un `set-state-in-effect` (`App.tsx:94`). **Restent (15)** : `react-hooks/set-state-in-effect`
  ×12 — `App.tsx:94`, `App.tsx:227`, `design/settings/SettingsModal.tsx:127` et `:132`, `screens/BuildsScreen.tsx:579`,
  `screens/builder/BuilderScreen.tsx:139` et `:389`, `screens/builder/HeroSelect.tsx:35`,
  `screens/builder/PromptDialog.tsx:19`, `screens/builder/useSolverSession.ts:243`,
  `screens/inventory/FilterModal.tsx:185`, `screens/inventory/InventoryScreen.tsx:86` ; `react-hooks/refs` ×1 —
  `App.tsx:235` ; `react-hooks/incompatible-library` ×2 — `screens/builder/ResultsTable.tsx:289`,
  `screens/inventory/VirtualGearGrid.tsx:143` (chemins sous `apps/renderer/src/`).
- ✅ **(2) Builder réveillé par l'élagage (G29).** `lib/storage/dataHash.ts` gagne
  `onDataPruned(listener: (known: KnownRefs) => void): () => void`, calqué sur `onBackupImported` (`transfer.ts`) ;
  `reconcileDataHash` notifie les abonnés en fin de course, après l'écriture des deux cartes, seulement quand
  l'issue est `"pruned"` (`known` n'est posé que dans cette branche). `BuilderScreen.tsx` s'y abonne à côté de
  l'abonnement à l'import : recharge `filterPresetsMap`, remplace `heroFiltersRef.current` par `loadHeroFilters()`
  (déjà élaguée sur disque) et, si `pruneFilters(filtersRef.current, known)` rend un autre objet,
  `dispatch({ type: "loadPreset", filters })` — filtres vivants élagués, résultats de solve intacts. Un changement de
  héros ne réécrit plus les références mortes.
- ✅ **(3) Statut visible dans Settings (G19).** `SettingsModal` gagne `status: string` (`App.tsx` passe
  `status={status}`) ; le `<span>` gauche du pied affiche `status || FOOTER_NOTE[tab]`, même style. Les messages
  d'Export / Import / Sync / Remove plugin / Wipe se lisent sans fermer la modale ; la barre de statut ne bouge pas.
- ✅ **(4) Pièce réservée non « libre » (G28).** `AdviceInput` gagne `heroUid: string` et
  `claimedBy?: Readonly<Record<string, string>>` ; la règle 3 ne compte libre qu'une pièce `equippedBy == null` ET
  non réclamée ou réclamée par ce héros-ci (sa réservation est le plan). `App.tsx` passe
  `worklistClaims={solverWorklistClaims}` à `<BuildsScreen>`, qui le met dans chaque `ComposedEntry`
  (`heroUid: c.uid`, `claimedBy`) ; `worklistClaims` rejoint les dépendances du `useMemo` de composition (la carte
  ne change qu'avec la Worklist ou l'inventaire). Fixtures `AdviceInput` de `gameRules.test.ts` et
  `sheetMinors.test.ts` : `heroUid: "h"` ajouté (typecheck).
- ✅ **(5) `upg` vivant (G25).** `ResultsTable` gagne `heroUid: string | null` (le Builder passe `selectedUid`) ; un
  `useMemo` calcule `liveUpg: Map<SolveBuild, number>` (nombre de `changed` de `diffBuildVsLoadout` par build, une
  passe, dépendances `builds`, `heroUid`, `pieceByUid`) ; la cellule (valeur et titre) et le tri `upg` lisent
  `liveUpg.get(build) ?? build.upg`, passé à `ResultRow` en prop `upg` (primitive : le memo de ligne tient).
  L'entrée Worklist prend `upg: changes.length`. Tête de `buildDiff.ts` mise à jour, et `docs/solver.md` /
  `wiki/Solver.md` (en-tête « N slots change »).
- ✅ **(6a) Pré-tri Score (G10).** `statRegistry.ts` exporte `PCT_ROLL_KEYS` (clés des variantes `kind: "pct"`) et
  `isPctRollWithoutNorm(r)` = `percent` ET clé d'un axe du registre ET hors `PCT_ROLL_KEYS` (« a % roll on a
  flat-only axis (Phantasm's −30 % SPD) has no roll norm; the pre-sort ignores it instead of scoring it as flat » ;
  un roll hors registre garde son repli `?? 100`). `priorityScoreOf` et `magnitudeScoreOf` (`engine.ts`) sautent ces
  mains en plus des `combatOnly`. Docs : `docs/solver.md` (3a), `docs/reference.md` (§ classement 1 et 3), miroirs
  `wiki/Solver.md` et `wiki/Engine-Reference.md`.
- ✅ **(6b) Pastille combat survolable (G9).** `GearDetailBody` (`design/GearDetail.tsx`) gagne `inTooltip?: boolean`,
  transmis à `SetEffectRow` puis à `<SetCombatBadge expanded={inTooltip} />` ; `BuildsScreen.tsx` le passe à la
  mini-pièce sous `RichTooltip`. Grep des autres `GearDetailBody` : seul `screens/inventory/ItemDetail.tsx` (panneau
  cliquable) — inchangé ; `ResultGearDetailBody` est un autre composant, hors lot.
- ✅ **(7) `img-cache-revalidate.test.ts` stabilisé.** « stale + 304 » et « stale + 200 » tiennent le `fetch` stubbé
  derrière une barrière (modèle de « never runs two revalidations ») libérée après le retour de `call(…)`, puis
  `settleImgRevalidations()` ; deux lignes de commentaire disent la course (flux ouvert après le renommage).
  `img-cache.ts` inchangé. `npx vitest run apps/desktop/test/img-cache-revalidate.test.ts` joué 20 fois en boucle
  shell : 20/20 verts.
- ✅ **Tests.** `dataHash.test.ts` (+1) : `pruned` notifie avec `known` (cartes déjà élaguées sur disque quand
  l'abonné tourne), `first` et `same` ne notifient pas, désabonnement. `buildAdvice.test.ts` (22 → 24) : réservée
  pour un AUTRE héros → « one more piece completes 4pc », pas de « a free » ; réservée pour ce héros → toujours libre.
  `buildDiff.test.ts` (+1) : `upg` vivant — une pièce équipée depuis le solve (inventaire relu) donne `changed` − 1.
  `statRegistry.test.ts` (11 → 13) : `PCT_ROLL_KEYS` = exactement les variantes `pct` ; `magnitudeScoreOf` d'une
  pièce dont le seul main est `{ stat: "spd", value: -30, percent: true, source: "uniquePassive" }` vaut 0 (le même
  main plat vaut −1,5). Compteurs de `docs/reference.md` / `wiki/Engine-Reference.md` mis à jour pour ces deux
  fichiers ; `wiki/Using-the-App.md` précise la pièce libre.
- ✅ **Comportement** (relu sur les diffs React, pas d'app lancée) : hooks tous inconditionnels, ordre stable d'un
  rendu à l'autre ; les écritures de ref déplacées en effet sont déclarées avant les effets qui les lisent ; aucun
  texte changé hors (3). Builds (cartes, infobulle de mini-pièce : la pastille s'y déplie comme dans le panneau
  Effects), Builder (solve, Equip, + Worklist, changement de héros), Inventory (tri de `SortHeader`, même JSX),
  Settings (pied) : mêmes rendus hors (3) et (6b).
- ✅ **Vérification.** `npm run typecheck` : sort à 0, dernière ligne `> tsc --noEmit` (renderer, sans erreur) ;
  `npm test` : dernière ligne `Duration  1.81s (transform 2.50s, setup 0ms, import 4.60s, tests 2.32s, environment 5ms)`
  (core 162, desktop 159, renderer `Tests  579 passed (579)`).
- ⏳ **Sevih** : `docs/release-notes.md` [Unreleased] à remplir avant la release (G8 à G32) ; les 15 avertissements
  restants (`set-state-in-effect`, `incompatible-library`, le `refs` du suiveur) demandent une réécriture qui change
  l'ordre des rendus — hors lot.

### 🤖 CI — Dependabot npm et github-actions hebdomadaires, actions épinglées par SHA (2026-10-19)
- ✅ **Pourquoi.** Lot de clôture de la CI (G33) : le dépôt n'avait ni `dependabot.yml` ni actions épinglées par
  SHA — un tag mobile `@v4` peut être déplacé sous la CI sans que rien ne change dans le dépôt, et aucune mise à jour
  de dépendance n'était proposée. Dependabot `npm` est voulu ici : une PR ne déclenche que `ci.yml`, rien n'est publié
  au merge, la release reste un geste manuel. Le lot ne monte aucune dépendance (ni `package.json` ni
  `package-lock.json` touchés) et ne change la majeure d'aucune action.
- ✅ **`.github/dependabot.yml`** (nouveau, `version: 2`, commentaires en français) : (a) `npm`, `directory: '/'` (le
  lockfile unique de la racine et les `workspaces` du `package.json` racine couvrent `apps/desktop`,
  `apps/renderer` et `packages/core`), hebdomadaire, groupe `minor-and-patch` (`patterns: ['*']`,
  `update-types: ['minor', 'patch']`) — un PR hebdo pour mineures et patchs, les majeures une par une —,
  `commit-message.prefix: 'chore(deps)'`, aucune liste `ignore` (Electron, electron-builder, Vite, React, ESLint
  compris : chaque PR se juge à part) ; (b) `github-actions`, `directory: '/'`, hebdomadaire, même groupe,
  `commit-message.prefix: 'ci(deps)'`, avec le rappel que Dependabot réécrit le SHA et le commentaire ` # vX.Y.Z`.
  `open-pull-requests-limit` laissé au défaut (5).
- ✅ **Épinglage**, les deux actions restant sur leur majeure v4 (v7 existe pour les deux : viendra par une PR
  Dependabot à part) : `ci.yml` → `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0` et
  `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0` ; `publish-wiki.yml` → le même SHA de
  `actions/checkout`. Rien d'autre ne change dans les workflows (`git diff .github/workflows/` : les trois lignes
  `uses:` seules). SHA relevés le 19/10 par
  `gh api repos/actions/checkout/git/matching-refs/tags/v4. --jq '.[] | "\(.ref) \(.object.sha) \(.object.type)"'`
  (dernier : `refs/tags/v4.4.0 11d5960a… commit`) et la même commande sur `actions/setup-node` (dernier : `refs/tags/v4.4.0 49933ea5… commit`), contrôlés par
  `gh api repos/actions/<repo>/git/ref/tags/v4.4.0 --jq '.object.sha'` : tags légers (`commit`), rien à
  déréférencer.
- ✅ **Vérification** (pas d'`actionlint` sur le poste) : les trois YAML parsent avec `js-yaml` de `node_modules`, et
  PyYAML relit `dependabot.yml` avec les clés attendues (`version`, puis pour chaque entrée de `updates` :
  `package-ecosystem`, `directory`, `schedule.interval`, `groups`, `commit-message`) ;
  `grep -n "uses:" .github/workflows/*.yml` ne laisse aucune ligne hors de la forme
  `uses: [a-z0-9-]+/[a-z0-9-]+@[0-9a-f]{40} # v[0-9]+\.[0-9]+\.[0-9]+$` ;
  `gh api repos/actions/checkout/commits/11d5960a… --jq '.sha'` et
  `gh api repos/actions/setup-node/commits/49933ea5… --jq '.sha'` répondent (les commits existent sur le dépôt de
  l'action). `npm run typecheck` : `tsc --noEmit` (code 0) ; `npm test` : `Tests  573 passed (573)` ;
  `npm run lint` inchangé : `✖ 28 problems (0 errors, 28 warnings)`. Docs : ni `docs/architecture.md` ni
  `docs/STATUS.md` ne décrivent la CI, et `README.md` ne cite `publish-wiki.yml` que pour la publication du wiki —
  rien à y ajouter ; `docs/todo.md` n'a aucun item CI, non touché.
- ⏳ **Sevih** : au push, la CI doit passer avec les SHA (première exécution réelle de l'épinglage, Linux et
  Windows, et `publish-wiki.yml` au prochain changement de `wiki/`) ; la première série de PR Dependabot arrive dans
  la semaine ; Settings → Dependabot « Security updates » est à activer à part sur GitHub si voulu (hors fichier).

### 📜 Données — règles du jeu lues du contrat, `progression.json` synchronisé, main d'EE Accuracy affiché combat-only, suivis de G12 (2026-10-19)
- ✅ **Pourquoi.** Lot de clôture (G31) de trois restes : les règles recopiées à la main (emplacements de gemme,
  budget de reforge, niveaux de déblocage des évolutions) sont émises par le contrat depuis B62 d'outerpedia ; le
  main d'EE `ST_AVOID` (« Accuracy vs <élément> ») disparaissait de la fiche de la pièce au lieu d'y être affiché
  combat-only (suite de L6) ; petits suivis documentaires de G12.
- ✅ **Module de règles** `packages/core/src/rules.ts` (exporté par l'index de core) : `GameRules` (`gemSlots` par
  slot `ooparts` / `exclusive` = `{ base, unlockLevel, unlockSlots, unlocks }`, `reforge` = `{ maxTicksPerSub,
  countByStar, ascendedBonus }`, `evoUnlockLevel`), `DEFAULT_RULES` (les constantes d'avant, à l'identique : 4 + 1 à
  +5, 6, 1..6, +3, 20/40/60/80/100/105/110/120) et `gameRulesOf(game)`, qui lit `enhance.gemSlots`
  (`baseByGrade.unique` + `unlocks[slot]`), `enhance.reforge` et `progression.evoUnlockLevel`, chaque bloc avec repli
  sur `DEFAULT_RULES` quand la clé (ou la table, fixtures partielles) manque — cache synchronisé avant B62,
  installation dont la sync au lancement n'a pas encore récupéré `progression.json` : jamais de jet. Mémoïsé par objet
  `GameData` (`WeakMap`). Écart de forme assumé : `GemSlotRule` porte en plus `unlocks` (tous les paliers triés),
  car la somme de plusieurs paliers dépend du niveau de la pièce et ne tient pas dans `{ unlockLevel, unlockSlots }`
  (premier palier, gardé pour le texte du conseil) ; `gemSlotsAt(rule, level)` fait la somme. `GameData` gagne
  `progression?`, `EnhanceData` gagne `gemSlots?` / `reforge?` (types `EnhanceGemSlots`, `EnhanceReforge`) ;
  `loadGameData` charge `/gamedata/progression.json` en option (absent → pas de clé, le chargement n'échoue pas).
- ✅ **Lecteurs**, par paramètre explicite avec défaut `DEFAULT_RULES` : `gemSlotsOf(piece, rules)` ;
  `maxReforgesOf(piece, ascended, rules)` (`countByStar[star] ?? star`, `+ ascendedBonus` en 6★ ascendée) ;
  `simulateReforges(…, rules)` lit `maxTicksPerSub` (fin de `REFORGE_PER_SUB_CAP`) ; `REFORGE_PLANS` devient
  `reforgePlansOf(rules)` mémoïsé (plafonds de mode inchangés, budgets = `countByStar[6]` et `+ ascendedBonus`),
  lu par `pieceReforgePlan(piece, mode, rules)` et `meetsMaxedFloor(…, rules)` ; `sumEvoUpTo(…, evoUnlockLevel)` et
  `ComposeOptions.evoUnlockLevel`, passé par les trois appelants de `composeCharStats` (`engine.ts`,
  `BuilderScreen.tsx`, `BuildsScreen.tsx`). `precomputeContext` et `solveChunk` calculent `rules` une fois ;
  `projectPieceForReforge`, `buildAdvice` (règle 5 : `gemSlotsOf`, texte « reach +N » lu du palier) et `adapter.ts`
  lisent `gameRulesOf(game)` quand `game` est là. Les variantes de talisman précalculées (`[4, 5]` en dur) sont
  dérivées des paliers (base, puis chaque palier cumulé) : mêmes variantes aujourd'hui, pas de trou si le contrat
  change. Commentaires « Observed max in real captures » / « in-game budget » → « contract `enhance.json › reforge`
  (fallback: DEFAULT_RULES) ». L'item « `buildAdvice` propose +5 aux talismans 4★/5★ » était faux (tous `unique` :
  4 + 1 à +5, l'étoile n'entre pas dans la règle) : retiré sans changement.
- ✅ **`progression.json` synchronisé** : ajouté à `apps/desktop/src/solver-files.json` (21 noms) ; « 20 » → « 21 »
  dans `data-sync.ts`, `data/sync.mjs`, `data-sync.test.ts`, `docs/reference.md` / `wiki/Engine-Reference.md`,
  `docs/STATUS.md`, `data/README.md`, `docs/architecture.md` / `wiki/Architecture.md` ; tableau des sources : ligne
  `CharacterEvolutionTemplet.json` → `progression.json`, `gemSlots` / `reforge` sur la ligne `enhance.json` ;
  `data/README.md` décrit `progression.json` ; `rules.ts` dans l'arbre de core des deux références. `npm run
  data:sync` : `data/derived/progression.json` nouveau et rien d'autre, hash `66681131bd9f` inchangé.
- ✅ **`ST_AVOID`** : `StatType` gagne `"avoid"`, `GAME_STAT` gagne `ST_AVOID` (flat), `CONTRACT_STAT_TO_ENGINE.avoid`
  = `"avoid"` ; `STAT` (`tokens.ts`, `ACC` / « Accuracy », sans icône), `STAT_DISPLAY_ORDER` et `STAT_LABEL` le
  gagnent en dernier, `GEAR_STATS` l'exclut comme les stats de set. Le main s'affiche dans le panneau avec son
  `name` du contrat et le drapeau `combatOnly` de la ligne ; la fiche et la CP ne le lisent pas (déjà sauté par
  `composeBuild.ts`). Aucun autre changement visuel.
- ✅ **Suivis de G12** : `wiki/Engine-Reference.md` donne le vrai ordre de recherche du checkout (`OUTERPEDIA_PATH`
  env → `.env.local` → `../outerpedia`) ; M8 requalifié « livré » (installeur, données embarquées, mise à jour
  automatique, releases 1.9.0 et 1.10.0) dans `docs/roadmap.md` / `wiki/Roadmap.md` et `docs/STATUS.md`, reste la
  vérification de la sync repo en prod packagé (`docs/todo.md`) ; « 95 tests » de `solver.test.ts` → 117 (compte
  affiché par vitest, `it.each` compris). L'item « data-sync, octets non JSON » n'existe plus dans `docs/todo.md` :
  rien à faire. Le script de rejeu des EE qui ne compte pas l'`IOT_STAT` n'est pas dans ce dépôt (aucun script
  sous `scripts/` ni `data/` ne lit `IOT_STAT`) : rien à faire ici.
- ✅ **Tests.** `packages/core/test/rules.test.ts` (nouveau, 5) : garde de non-régression (`gameRulesOf` sur
  `enhance.json` + `progression.json` committés = `DEFAULT_RULES`), repli sans `gemSlots` / `reforge` /
  `progression`, lecture d'un contrat modifié (4 sous +7, 6 à +7 ; `countByStar["6"] = 7`, bonus 2 ; ligne 7 à
  lv 100 comptée par `sumEvoUpTo`), somme de deux paliers, mémoïsation. Le cas (c) côté renderer est dans
  `apps/renderer/test/gameRules.test.ts` (nouveau, 3 : `gemSlotsOf`, `maxReforgesOf` 7 / 9, `pieceReforgePlan`,
  texte du conseil « reach +7 to unlock 2 more gem slots ») — core ne dépend pas du renderer. `parse.test.ts` :
  fausse EE dont le main pointe `BID_CEQUIP_MAIN_ACCURACY_FIRE` → `{ stat: "avoid", value: -30, combatOnly,
  name: "Accuracy vs Earth", fromBuff, source: "option" }` ; `eePassive.test.ts` : fiche identique avec et sans
  ce main ; `stat-keys.test.ts` : 24 paires résolues, aucune à null ; `data-sync.test.ts` : 21 tables.
  `solver.test.ts` (`gemSlotsOf`), `buildAdvice.test.ts`, `cpPin`, `solveChunkCritCap`, `setCombatEffects`,
  `calcBattlePower` : aucune attente modifiée. `npm run typecheck` : vert (dernière ligne `> tsc --noEmit`, renderer) ;
  `npm test` : core `Tests 162 passed (162)`, desktop `Tests 159 passed (159)`, renderer `Tests 573 passed (573)` ;
  `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)`, comme avant.
- ⏳ **Laissé.** Le total « 300 tests » de `docs/reference.md` / `wiki/Engine-Reference.md` n'est pas recompté
  (hors périmètre). Un commentaire de `lib/storage/filterPresets.ts` cite encore `REFORGE_PLANS[undefined]` (hors des
  fichiers du lot). `OptionMaxValue` à la lecture des subs et le filtre TargetType d'`ee-passives` restent hors
  périmètre.

### 🧩 Renderer — composants monolithiques découpés, un dossier par écran, sans changement de comportement (2026-10-19)
- ✅ **Pourquoi.** Item « Composants monolithiques » de `docs/todo.md` : à `edc18fe`, `BuilderScreen.tsx` faisait
  4 435 lignes (~45 composants, le reducer déjà parti dans `lib/solver/builderFilters.ts`), `InventoryScreen.tsx`
  1 340, `HomeScreen.tsx` 1 178 (dont `computeStats` ~200), `design/SettingsModal.tsx` 908. Déplacements seulement :
  aucun changement de logique, de rendu, de texte ni de perf.
- ✅ **Commits.** `041d3a1` `refactor(builder)`, `7ec25e8` `refactor(settings)`, `7bb058f` `refactor(inventory)`,
  `31b8b5a` `refactor(home)`, puis cette entrée. Diffstat : 39 fichiers (+4 773 / −4 444), 14 (+961 / −915),
  14 (+1 397 / −1 351), 14 (+1 242 / −1 188) ; le surplus est fait des imports et d'un en-tête par module.
- ✅ **Méthode.** Découpage outillé par l'API du compilateur TypeScript : chaque déclaration de tête est recopiée
  telle quelle (texte et commentaires de tête compris, séparateurs `/* ─── */` inclus) dans son module, `export`
  ajouté seulement si un autre module la lit, imports recalculés d'après les symboles réellement référencés,
  aucun cycle entre modules, pas de barrel. Contrôle : chaque ligne non vide de l'ancien fichier se retrouve dans
  le nouvel ensemble (seuls les imports diffèrent) ; `git log -p --color-moved=zebra` marque déplacées 8 388 /
  1 656 / 2 506 / 2 152 lignes du diff, contre 137 / 28 / 40 / 64 lignes simples hors imports et en-têtes
  (préfixes `export`, lignes trop courtes pour la détection, docs).
- ✅ **Builder** (`screens/builder/`, 4 435 → 4 748 lignes en 30 fichiers) : `BuilderScreen.tsx` 781,
  `useSolverSession.ts` 275, `ResultsTable.tsx` 631 (table, lignes, heatmap, menu des colonnes), `BuilderToolbar.tsx`
  394, `catalogs.ts` 232, `OptionsPanel.tsx` 189, `SetsPanel.tsx` 176, `IconChips.tsx` 164, `statColumns.ts` 156,
  `RightSidebar.tsx` 155, `FilterFooter.tsx` 148, `BottomGearBand.tsx` 136, `HeroSelect.tsx` 119,
  `BuildEffectsPanel.tsx` 119, `DmgPer1PctPanel.tsx` 108, `StatFiltersPanel.tsx` 99, `AccessoryMainStatsPanel.tsx`
  98, `EquipBuildButton.tsx` 95, `SubstatPriorityPanel.tsx` 93, `WeaponsAccessoriesPanel.tsx` 84, `SubValuePanel.tsx`
  70, `StatsPanel.tsx` 62, `PromptDialog.tsx` 60, `RecoBuildPicker.tsx` 60, `RatingFiltersPanel.tsx` 56, `Panel.tsx`
  39, `reforge.ts` 35, `composition.ts` 34, `solveCounts.ts` 32, `heroName.ts` 25, `useClickOutside.ts` 23.
- ✅ **`useSolverSession`** regroupe l'état qui existait : mode de solve, orchestrateur (création paresseuse,
  dispose au démontage, reconstruction au changement de `workerCount`), `startSolve` / `cancelSolve`, estimation
  pré-solve débouncée, progression, résultats, filtre client post-solve (`buildPassesFilters`, `applyClientFilter`).
  Ordre des effets inchangé : l'appel du hook prend la place du premier effet qu'il porte (après le layout effect
  des refs et l'abonnement `onBackupImported`), et ses trois effets (dispose, `workerCount`, estimation) se
  suivaient déjà sans autre effet entre eux. Seuls le mémo pur `selected` et des `useState` sans effet de bord
  remontent ou restent avant l'appel.
- ✅ **Laissé dans `BuilderScreen.tsx`, et pourquoi.** L'effet de changement de héros : il réinitialise à la fois
  les filtres (refs et `dispatch` de l'écran) et la session, et le mettre dans le hook le ferait passer avant
  l'effet qui efface le statut de reco. Il lit désormais les setters rendus par le hook : `exhaustive-deps` ne les
  sait plus stables et levait un avertissement de plus ; tableau de dépendances inchangé, un
  `eslint-disable-next-line` commenté l'explique. Restent aussi les builds sauvés, presets, reco, Equip et
  Worklist (pas de l'état de solve).
- ✅ **Settings** (`design/settings/`, 908 → 954 lignes en 8 fichiers) : `SettingsModal.tsx` 266 (onglets, pied,
  icônes de navigation), `SteamSetupPane.tsx` 190, `SolverPane.tsx` 150 (avec le type `SolverSettings`),
  `SettingsControls.tsx` 106 (primitives partagées), `DataPane.tsx` 79, `BackupPane.tsx` 78, `DebugPane.tsx` 50,
  `useConfirmClick.ts` 35 (avec `useMountedRef`) ; les helpers export / import / wipe suivent leur pane.
- ✅ **Inventory** (`screens/inventory/`, 1 340 → 1 386 lignes en 7 fichiers) : `InventoryScreen.tsx` 333,
  `FilterModal.tsx` 474 (avec le bouton Filter), `VirtualGearGrid.tsx` 196, `filters.ts` 175 (état des filtres et
  des onglets, codec de session, prédicats), `InventoryTabs.tsx` 82, `SortHeader.tsx` 66, `ItemDetail.tsx` 60. Le
  commentaire glissé entre deux imports (helpers de `design/GearDetail`) suit l'import de `ItemDetail.tsx`.
- ✅ **Home** (`screens/home/`, 1 178 → 1 230 lignes en 9 fichiers) : `HomeScreen.tsx` 425, `lib/homeStats.ts` 307
  (`computeStats` et son vocabulaire, pur), `HomePrimitives.tsx` 125, `UpdateCard.tsx` 104, `ExportRosterButton.tsx`
  68, `OopartsTable.tsx` 61, `ClassEffectRow.tsx` 57, `EmptyDashboard.tsx` 49, `HomeIcons.tsx` 34. `homeSets.test.ts`
  importe `computeStats` depuis `lib/homeStats.js` ; sa doc « Exported for tests » dit maintenant que l'écran le lit.
- ✅ **Docs.** `docs/architecture.md` / `wiki/Architecture.md` (dossiers des écrans), arborescences de
  `docs/solver.md` / `wiki/Solver.md` et `docs/reference.md` / `wiki/Engine-Reference.md`, lien vers
  `BuilderScreen.tsx`, chemin de `SettingsModal.tsx` dans `docs/roadmap.md` / `wiki/Roadmap.md`.
- ✅ **Vérifié.** `npm run typecheck` : `> tsc --noEmit` sans erreur (dernière ligne) ; `npm test` : `Tests  569
  passed (569)` (core 156, desktop 157) ; `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)` puis `0 errors
  and 1 warning potentially fixable with the --fix option.`, les mêmes 28 qu'avant (ceux de Builder, Settings et
  Inventory ont suivi leur code). `vite build` : le chunk `BuilderScreen` passe de 104,55 à 105,98 kB (32,40 →
  32,63 kB gzip, les liaisons entre modules), les autres chunks inchangés.
- ✅ **Vu en route, hors périmètre.** `apps/desktop/test/img-cache-revalidate.test.ts` a échoué une fois sur un
  `npm test` complet puis est passé trois fois de suite (minutage) ; directive `eslint-disable` inutile à
  `App.tsx:256` ; dans `startSolve`, la constante locale `selected` masque désormais le paramètre du même nom du
  hook (même valeur, comme avant avec le mémo de l'écran).
- ⏳ **Sevih** : contrôle à l'écran de chaque onglet — Builder (solve, filtres, presets, Equip, Worklist),
  Inventory, Home, Settings.

### 🗂️ Données — références mortes élaguées au changement de `hash` du contrat (2026-10-19)
- ✅ **Pourquoi.** Item « Snapshot `data/` versioning » de `docs/todo.md` : le `hash` de `version.json` n'était lu
  que par Settings → Data. Après un patch qui retire un set d'armure ou un effet d'arme / d'accessoire / de
  talisman, un preset qui l'exigeait encore vidait le pool sans rien dire (« no builds »).
- ✅ **Comment.** Nouveau module `apps/renderer/src/lib/storage/dataHash.ts`. `knownRefs(game)` collecte les ids de
  set (`game.sets`) et les clés d'effet (`EquipmentDef.setId`, celles que le moteur compare dans `allow`) ;
  `pruneFilters` (pure) retire des `setPlans` et `excludedSets` les sets inconnus et des trois `…EffectPicks` les
  clés inconnues, laisse le reste tel quel (même objet rendu quand rien n'est mort), écarte un plan vidé par
  l'élagage (un plan vide accepterait tout) et garde `[[]]` au minimum, comme l'éditeur. `reconcileDataHash(hash,
  game)` lit `gs.data.hash` (localStorage, en `try`) : première fois, il le stocke ; même `hash`, rien ; `hash`
  changé, il élague les presets (`filterPresets.ts`) et les filtres par héros (`heroFilters.ts`, sessionStorage),
  ne réécrit que ce qui a bougé, puis stocke le nouveau `hash`. Une donnée qui ne connaît aucun set ou aucun effet
  (chargement cassé) n'élague rien et ne stocke pas le `hash`, pour que le chargement suivant réessaie.
- ✅ **Branchement.** `refreshInventory` (`App.tsx`) lit `loadDataVersion()` en parallèle d'`autoImport()` et
  appelle `reconcileDataHash` avant `setGame`, donc au démarrage comme après une synchro (« Game data updated »,
  « Game data synced »), avant qu'un Builder monté ensuite ne relise le stockage.
- ✅ **Décision suivie.** On n'efface jamais une donnée de l'utilisateur : seules les références que la donnée ne
  connaît plus sortent ; les builds sauvés (`savedBuilds.ts`) restent intacts, les pièces disparues de
  l'inventaire et le cache disque du bureau sont hors périmètre.
- ✅ **Docs.** `docs/data-schema.md` / `wiki/Data-Schema.md` (cycle après patch) et le paragraphe du `hash` de
  `docs/reference.md` / `wiki/Engine-Reference.md`, qui annonçaient encore une invalidation « future ».
- ✅ **Tests.** `apps/renderer/test/dataHash.test.ts` (7) : `pruneFilters` (sets et effets morts retirés, plan
  vidé écarté, `[[]]` au minimum, même objet sans référence morte) ; `reconcileDataHash` première fois (`hash`
  stocké, rien touché), même `hash` (rien), `hash` changé avec un set disparu dans un preset et dans un filtre par
  héros (élagués, nom, `excludedHeroes` et `topPct` gardés), donnée sans set (rien élagué, ancien `hash` gardé).
  `npm run typecheck` : `> tsc --noEmit` sans erreur (dernière ligne) ; `npm test` : `Tests  569 passed (569)` ;
  `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)`, `App.tsx` en garde 11 avant comme après, les deux
  nouveaux fichiers sont propres.
- ⏳ **Laissé.** Un Builder déjà monté au moment d'une synchro garde ses cartes en mémoire (`filterPresetsMap`,
  `heroFiltersRef`, filtres vivants) : son prochain enregistrement peut réécrire une référence morte jusqu'au
  `hash` suivant. Le corriger demande d'écouter l'élagage dans `BuilderScreen.tsx` (comme `onBackupImported`),
  hors du périmètre de ce lot.

### 💡 Advices (Builds) — pièce libre pour le 4P, pièces de basse qualité (2026-10-19)
- ✅ **Pourquoi.** Item « `Advices` (tab Builds) » de `docs/todo.md`, lot secondaire : `computeAdvice`
  (`apps/renderer/src/lib/buildAdvice.ts`) ne voyait que les pièces portées, si bien que la règle 3/4 disait
  « one more piece completes 4pc » sans savoir si une telle pièce existait, et aucune règle ne regardait la qualité.
- ✅ **Entrée.** `AdviceInput` gagne `inventoryPieces` (toute la liste `inventory.gear`) et `dmgStat`
  (`meta.dmgStat`, `"atk"` par défaut). `ComposedEntry` de `screens/BuildsScreen.tsx` porte les deux champs, posés
  dans `composedRoster` (le même tableau `inventory.gear` pour toutes les entrées) : l'entrée reste passée telle
  quelle, le `useMemo` de la carte garde `[entry, game]` comme dépendances et aucune prop de `BuildCard` ne
  change, donc les cartes mémoïsées ne se re-rendent pas plus qu'avant (l'entrée ne change qu'avec l'inventaire).
- ✅ **4P disponible (règle 3).** Pour un set à 3/4 avec 4P, l'emplacement d'armure manquant est celui des quatre
  (`helmet`, `armor`, `gloves`, `boots`) que les trois pièces ne remplissent pas ; si l'inventaire a une pièce de
  ce set dans cet emplacement avec `equippedBy == null`, le conseil devient « Sharp: 3/4 — a free Boots of this set
  is in your inventory » ; une pièce portée par un autre héros ne compte pas, et sans pièce le texte actuel reste.
- ✅ **Basse qualité (règle 7).** Les pièces portées dont `gearPieceQualityTier` (`lib/quality.ts`, la règle de
  l'onglet Inventory) vaut `poor` sont listées dans une seule ligne `info` (« Poor quality: Weapon, Boots »), dans
  l'ordre des emplacements ; Talisman, EE et pièces sans sous-stats n'ont pas de palier et sont ignorés.
- ✅ **Docs.** `wiki/Using-the-App.md` (liste des conseils), `docs/STATUS.md`, et la ligne de
  `buildAdvice.test.ts` dans `docs/reference.md` / `wiki/Engine-Reference.md` (22 tests). Les totaux de tests de
  ces deux pages (« 300 tests ») étaient déjà faux avant ce lot ; je ne les ai pas touchés.
- ✅ **Tests.** `apps/renderer/test/buildAdvice.test.ts` (17 → 22) : 3/4 avec pièce libre (et sans l'ancien
  texte), 3/4 dont la seule pièce assortie est portée par un autre héros (texte actuel), 3/4 sans pièce du set pour
  l'emplacement (pièce du set ailleurs, Boots d'un autre set : texte actuel), pièces `poor` listées en une ligne
  dans l'ordre des emplacements, rien quand aucune pièce n'est `poor` ni pour un talisman. Les fixtures ont reçu
  les deux nouveaux champs, et l'appel de `sheetMinors.test.ts` aussi (sinon le typecheck échoue). `npm run
  typecheck` : `> tsc --noEmit` sans erreur ; `npm test` : `Tests  562 passed (562)` ; `npm run lint` :
  `✖ 28 problems (0 errors, 28 warnings)`, autant qu'avant (aucun ne vient des fichiers du lot).
- ⏳ **Règle main off-scaling vs `meta.dmgStat`** non faite : le principe du module l'exclut (pas de règle qui
  demande de deviner l'intention, « off-stat main » cité en exemple). Décision à prendre ; `dmgStat` est déjà
  passé, il ne restera que la règle à écrire.
- ⏳ Contrôler les cartes Builds sur un vrai compte (nouvelles lignes « a free … » et « Poor quality »).

### 🧪 Tests — crit-cap de bout en bout dans `solveChunk`, flux de l'orchestrateur (2026-10-19)
- ✅ **Pourquoi.** Items « Crit-cap slow path de bout en bout » et « Flux orchestrateur » de `docs/todo.md` (audit
  Builder du 03/07, revérifiés le 18/10) : aucun test ne passait par `wantCritCap` dans `solveChunk`, et
  `SolverOrchestrator` n'était instancié que par `orchestratorFailure.test.ts` (échec d'un worker et cause d'un
  résultat vide, ajoutés par la série des mineurs moteur). Tests seulement : aucune ligne de source ne bouge.
- ✅ **Crit-cap (`apps/renderer/test/solveChunkCritCap.test.ts`, 3 tests).** `SolveContext` construit à la main
  (comme `solveChunk.test.ts`), solve CP avec priorité `critRate` + `atk` : les gants portent le CHC (avant gemmes
  85, 94, 100 et 105 : sous, au plafond, au-dessus), un talisman 5 slots et un 4 slots couvrent les deux variantes
  du memo `capAllocCache`, les allocations par défaut sont celles d'`allocateGems` comme dans `precomputeContext`.
  Chaque build est revérifié contre une recomposition indépendante : CHC avant gemmes par `computeFinalStats` sans
  gemmes → `allocateGemsReachingCap` → `computeFinalStats` avec son delta → `calcBattlePower` ; gemmes, fiche et CP
  égales. Quand le delta du plafond égale le défaut, le build porte l'objet d'allocation précalculé lui-même (pas
  de recomposition), sinon une autre allocation. Deux pools : gemmes crit classées sous l'ATK (le défaut n'a aucune
  crit : recomposition sous le plafond seulement, valeurs ponctuelles 85 + 5 crit = 100, 4 slots = 97, 94 → 2 crit
  + 3 ATK) et au-dessus (le défaut est tout crit : seul le CHC 85 le garde, la soustraction `defaultCrcGem` est
  traversée). Deux chunks (partition sur les gants) redonnent exactement les builds du chunk unique, dans les deux
  cas. Contrôle par mutation : `wantCritCap` forcé à `false` fait tomber le premier test.
- ✅ **Orchestrateur (`apps/renderer/test/orchestratorFlow.test.ts`, 10 tests).** `vi.mock` du module
  `solver.worker.ts?worker` avec un faux `Worker` piloté par le test (Vitest le mocke : pas d'injection au
  constructeur), précompute stubé (pool partitionnable réglable). Cas : tous les chunks répondent → un seul
  `onResult` avec les builds fusionnés, un doublon ensuite sans effet ; 4 workers pour 2 chunks → les deux
  derniers ne reçoivent pas de `solve` et le flush n'attend que les dispatchés (`workersDone === activeChunks`) ;
  `solve` pendant un solve → `cancel` posté avant le nouveau `solve`, pas de second `init` (mêmes références), le
  `result` et le `progress` de l'ancien `solveId` ignorés (sans la garde, l'ancien solve se complétait), seul le
  nouveau émet ; `cancel` → flush immédiat de ce qui a fini (cause `null`), `cancel` à chaque worker, la suite
  ignorée, `cancel` au repos sans effet ; `onerror` pendant un solve → un `onError`, `cancel` partout, ni résultat
  ni second `onError` après, et ignoré au repos ; estimation → worker dédié, seule la dernière requête répond (la
  périmée et le doublon ignorés), `poolSizes: null` d'un précompute en échec livré tel quel, un crash du worker
  d'estimation abandonne la requête sans bannière et la suivante passe, un `solve` remplace l'estimation en
  attente et aucune estimation ne part pendant un solve. Contrôle par mutation : la garde `solveId` retirée de
  `handle()` fait tomber le test du solve remplacé.
- ✅ **Docs.** Les deux fichiers ajoutés au tableau des tests (`docs/reference.md` §3.3, miroir
  `wiki/Engine-Reference.md`) ; les deux items sortent de `docs/todo.md` (la section « Tests manquants » est vide
  et retirée).
- ✅ **Vérification.** Tests 857 → 870 (renderer 544 → 557, core 156 et desktop 157 inchangés).
  `npm run typecheck` : dernière ligne `> tsc --noEmit`, sortie 0 ; `npm test` : `Tests  557 passed (557)` puis
  `Duration  1.82s (…)`, sortie 0 ; `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)` / `0 errors and 1
  warning potentially fixable with the --fix option.`, aucun dans les fichiers ajoutés.
- ⏳ **Constaté, hors périmètre.** Aucun bug trouvé, donc aucun `it.skip`. Le crash du worker d'estimation
  n'appelle pas le callback avec `null` (la requête est abandonnée, le Builder garde l'estimation précédente) :
  c'est le comportement documenté dans `orchestrator.ts`, testé tel quel ; seul l'échec du précompute côté worker
  donne `null`. Un premier `npm test`, lancé avant toute modification, a fini sur `npm error command sh -c vitest
  run` sans échec visible dans la fin de sortie ; les cinq passes suivantes sont vertes, cause non reproduite.

### 🧮 Fiche — les mineurs de la revue : set Vitesse, CHC bornée, CP float32, plats de buff, `composeMultStat` sur `calcFinalStat` (2026-10-19)
- ✅ **Pourquoi.** Item « Mineurs de fiche (revue) » et puce CalcFinalStat de « Duplications » de `docs/todo.md`
  (revue du 09/10, revérifiés le 18/10). Après la série contrat (passif de cœur par fusion, `spdPct` en taux : passés,
  `pickCoreBlock` et `applySpdRate` relus tels quels), les gemmes SOLVE CP (M8) et les mineurs moteur / Builder.
  Sept points, dans l'ordre, chacun vérifié réel avant correction ; le huitième (`combatOnly` des mains d'EE décidé
  par le nom) reste, il est posé par le générateur d'outerpedia (contrat).
- ✅ **1. Set Vitesse sur une base sans les buffs OAT_ADD.** `finalStatsFromBuckets` multipliait le taux d'objet par
  `scaling.spd.value`, qui porte le +10 SPD du Skill_8 ; le client (`CalcFinalStat`) ne multiplie que base + évo +
  éveil (`sum_flat`). `SpeedScaling` gagne `rateBase` (base + évo + éveil IOT_STAT, `compose-stats.ts`) et le set
  % se lit `floor(rateBase × pct / 100)` ; repli sur `value` pour une carte sans `spd` (tests).
- ✅ **2. CHC bornée.** `FinalStats.critRate` est bornée à [0, 100] comme la fiche du client (`SetFinalValue`) : la
  fiche, l'affichage, les filtres et le scaling secondaire `crc` (Regina, `ratings.ts`) la lisent. La somme brute
  est dans le nouveau champ `critRateUncapped` (optionnel dans le type, toujours posé par le composeur : les fiches
  écrites à la main des tests restent valides), lu par les deux calculs qui mesurent le débordement : la
  réallocation crit-cap des gemmes (`engine.ts`, `preGemCrc` et le seuil `CRC_OVERSHOOT_CEIL`) et le conseil
  « wasted over the cap » (`buildAdvice.ts`). `BuildsScreen` type ses clés de fiche en `SheetStatKey` (le champ
  brut n'est ni affiché ni verrouillable). Aucun autre résultat de solve ne bouge : le score bornait déjà à 100
  (`SCORE_CAP_100`), la CP aussi (`min(…, 1000)`), `cpStatWeights` donne 0 au-delà du cap dans les deux cas ; le
  seul changement est celui demandé (filtres et `crc` de Regina, donc aussi le gain `dmg` de ses gemmes de
  remplissage au-delà du cap).
- ✅ **3. CP en float32.** `cpFrom` (`cp.ts`) porte la chaîne du client sous `Math.fround`, opération par opération,
  constantes comprises (`1.7f`, `1.05f`, `0.15f`, `0.25f`, `0.001f`), comme `calcNoGearBattlePower` d'outerpedia
  (C25) ; les entrées brutes (affiché × 10) arrondies à l'entier ; somme finale dans l'ordre du client (étoiles +
  skills, EE, talisman, fusion). `makeCpEvaluator` garde le même `cpFrom`. Contrôle hors dépôt : 0 écart sur
  200 000 fiches avec `calcNoGearBattlePower` d'outerpedia.
- ✅ **4. Plats de buff.** `addPieceToBuckets` envoyait tout `fromBuff` dans `buffPct` : un ATK/DEF/HP plat était
  perdu, un EFF/RES OAT_ADD lu comme un taux. Nouveau bucket `buffFlat` (`GearBuckets`), lu en `BuffValue` de
  CalcFinalStat (`composeMultStat(…, gearBuffFlat)`) ; le SPD plat des mains d'EE y passe aussi (`buffFlat.spd`,
  il était `buffPct.spd`), la vitesse en taux garde `buffPct.spdRate`. La dominance CP (`bucketDominatesStrict`)
  compare `buffFlat` sur les clés plates, le prefix du solveur le clone, le dump de debug de Builds l'affiche.
- ✅ **5 et 6. ATK/DEF/HP plats de la fiche nue.** `composeCharStats` met désormais classe + Skill_8 + geas
  IOT_BUFF + passifs de skill et de cœur dans `buffValue` (il valait 0) et la seule geas IOT_STAT dans
  `awakValue` (il prenait `geas.atk` toutes sources) : une règle pour les cinq axes. 0 écart sur la donnée : aucune
  source non IOT_STAT ne porte d'ATK/DEF/HP plat dans `characters.json` (vérifié, test qui le garde).
- ✅ **7. `composeMultStat` = `calcFinalStat`.** Le renderer appelle la fonction du core au lieu de sa copie.
  Égalité EXACTE vérifiée avant de toucher au code : 129 héros × 12 niveaux de codex × lv 1/50/100/120 × 5 axes ×
  7 plats × 12 taux × 6 taux de buff = 15 603 840 cas, 0 écart (le terme du codex `× codexPct / 100` contre
  `× (codexPct × 10) / 1000` et l'ordre des additions ne bougent rien sur la donnée).
- ✅ **Tests.** `apps/renderer/test/sheetMinors.test.ts` (14) : set Vitesse 4P sur le vrai contrat (Claire 133,
  Faenan 137, Delta 146) ; CHC 95 + 10 → 100 / 105, Regina `crc` à 130 brut = à 100, conseil sur la somme brute,
  réallocation crit-cap de bout en bout dans `solveChunk` (fiche 100, brut 107 → deux gemmes crit gardées, brut
  101) ; CP des trois fiches ±1 de la revue ; ATK plat de buff compté, EFF OAT_ADD 150 et non 156, dominance sur
  `buffFlat` ; `composeMultStat` contre l'ancienne copie, héros × codex × valeurs (557 280 cas). Douze des
  quatorze échouent sur l'ancien code (les deux autres gardent le conseil et le point 7, identiques avant).
  `packages/core/test/compose-stats.test.ts` (+2) : `buffValue` ATK/DEF/HP nul sur tous les héros, et la règle
  (classe + geas IOT_BUFF en `buffValue`, IOT_STAT en `awakValue`). Formes `scaling.spd` mises à jour
  (`rateBase`) dans `compose-stats.test.ts`, `coreFusionSpeed.test.ts`, `uniquePassive.test.ts`.
- ✅ **Rejeu de la revue** (copie hors du dépôt, chemins vers la racine du dépôt). `sets.ts` § A inchangé (les
  quatre cas égaux au jeu) ; § B avant : Claire 136 contre 133, Faenan 140/137, Delta 148/146, Snow 193/192 ; après :
  133/133, 137/137, 146/146, Snow 193/192 — le « jeu » du script pour Snow suppose l'ancien cœur cuit en plat ;
  avec le taux de 4,3 % de la série contrat, le client donne `trunc(trunc(149 × 1,25) × 1,043)` = 193, le solveur
  a raison. `moteur/t3.ts` avant : 1 148 écarts sur 200 000 ; après : 152, tous dus aux constantes en double du
  script (`1.7`, `1.05`, `0.15`, `0.25` sans `fround`) : 0 avec des constantes float32. `cp32.cjs` est autonome
  (son « solveur » est une copie de l'ancien `cp.ts`) : avant 798 / 200 000 (tirage `Math.random`) ; branché sur
  le nouveau `calcBattlePower` 603, 0 avec ses constantes en float32.
- ✅ **Docs.** `docs/reference.md` et `wiki/Engine-Reference.md` (§ 1.4 sortie du composeur, § 1.5 quatre buckets
  et CHC bornée, § 2.1 tableau des couches et SPD, § 2.2 float32 et ordre de la somme, § 2.3 CHC, table des tests) ;
  `docs/solver.md` et `wiki/Solver.md` (crit-cap sur `critRateUncapped`, CP et CHC bornée).
- ✅ **Vérifié.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (renderer, sans erreur). `npm test` : core
  « Tests 156 passed (156) », desktop « Tests 157 passed (157) », renderer « Tests 544 passed (544) ». `npm run
  lint` : « ✖ 28 problems (0 errors, 28 warnings) », les deux de `BuildsScreen.tsx` préexistants (lignes non
  modifiées par le lot).
- ⏳ **Sevih — en jeu.** Un héros à Skill_8 SPD (Claire, Faenan, Delta…) en 4P Vitesse : la fiche montre la
  vitesse du solveur ; une CP de build comparée à celle du jeu (le ±1 occasionnel doit avoir disparu).
- ⏳ **Hors lot, vu en passant.** Les perturbations de `dmgTickGains` / `cpStatWeights` ajoutent un pas à la CHC
  déjà bornée sans la reborner (`{ ...cur, critRate: cur.critRate + pas }`) : sans effet sur la CP ni sur `pCrit`
  (bornés en aval), mais le `crc` secondaire de Regina voit 102 au cap dans le panneau « DMG per 1 % ».

### 🧹 Moteur et Builder — les mineurs de la revue : tri, variantes, erreurs, sets cassés, épinglage, recos, en-tête, cycles (2026-10-19)
- ✅ **Pourquoi.** Item « Mineurs moteur / Builder (revue) » de `docs/todo.md` (revue du 09/10, revérifié dans le code
  le 18/10). Huit points indépendants, traités dans l'ordre ; tous vérifiés réels avant correction (aucun n'était
  déjà juste), le neuvième (`buildAdvice` et le 5e emplacement de gemme des talismans 4★/5★) reste hors lot.
- ✅ **1. Score non arrondi comme clé de tri.** `computeScore` (`ratings.ts`) rendait `Math.round(total)` : deux
  builds à quelques dixièmes tombaient ex aequo et sortaient dans l'ordre d'arrivée au tas, qui dépend du découpage
  entre workers. Il rend le total brut ; la table (`ResultRow`) et la bibliothèque (sous-titre des builds sauvés)
  l'arrondissent à l'affichage. Un ordre unique, `compareBuilds` (`engine.ts`) : objectif (score / CP, un CP nul en
  dernier) puis `pieceUids` élément par élément ; lu par `TopKHeap` (comparaisons du tas et `toSorted`) et par le tri
  final de l'orchestrateur (qui prenait `cp ?? 0` / `score` sans départage). Le filtre de bande `score` compare
  désormais la valeur brute, comme les autres ratings. Les builds sauvés avant gardent leur score entier.
- ✅ **2. Variantes de talisman réduites par worker.** `collapseTalismanVariants` ne jouait qu'à la fusion : le top-K
  d'un worker pouvait se remplir d'un même jeu de six pièces × talismans et perdre des candidats distincts.
  `TopKHeap` prend un plafond `variantsKept` (0 par défaut, `solveChunk` passe `TALISMAN_VARIANTS_KEPT` = 3, constante
  déplacée de l'orchestrateur vers `engine.ts`, une seule valeur pour les deux passages) : un build dont la signature
  (`variantSignature`, partagée avec le collapse) a déjà 3 entrées ne remplace que la pire d'entre elles (entrées
  indexées par position dans le tas, remplacement en place). La signature n'est construite qu'une fois le build
  admis face à la racine, donc rien de plus sur le rejet courant. Le collapse à la fusion reste pour une signature
  répartie sur plusieurs workers (talisman pris comme axe de partition). Même résultat quand rien n'était perdu.
- ✅ **3. Erreur d'un worker.** `onerror` et le message `error` appelaient `onError` puis `cancel()`, qui flushait :
  `onResult` livrait les builds des workers déjà finis, affichés sous la bannière rouge comme s'ils couvraient toute
  la recherche. Nouveau `fail()` privé (`orchestrator.ts`) : stoppe les workers, rend la suite périmée (`solveId`),
  vide le tampon, `onError` seul. Le Builder vide aussi la table et la sélection dans `onError`. Le `cancel()` de
  l'utilisateur garde son flush partiel.
- ✅ **4. `allowBrokenSets=false` + Top% à 0 build.** Cause : l'élagage Top% protège un membre par set requis, pas les
  sets « formables » qui permettent de compléter les emplacements libres ; aucune pièce gardée ne s'apparie et chaque
  loadout armor tombe à la feuille boots, sans slot vide donc sans `emptyReason`. `solveChunk` compte ces rejets
  (`brokenSetsRejected`, rejets dus à la seule règle des sets complets), le worker le poste, l'orchestrateur le somme
  et, sur un solve complet vide sans aucune combinaison atteinte, passe la cause `"brokenSets"`
  (`SolveEmptyCause`, `types.ts`) en 5e argument d'`onResult`. La table l'affiche à côté d'`emptyReason` (qui reste
  prioritaire) : « No builds — no armor combination completes its sets with “Allow broken sets” off. Turn it on, or
  raise Top % so more set pieces stay in the pools. » Le changement visuel est ce seul état vide.
- ✅ **5. SOLVE CP avec priorité.** L'épinglage de la pièce équipée par slot ne jouait que dans la branche CP sans
  priorité ; avec une priorité, la pièce actuelle pouvait sortir du budget et le solve rendre moins que le CP porté.
  `pinOf(slot)` est hissé avant les branches et passé aux deux branches en SOLVE CP ; SOLVE (Score) n'épingle rien.
- ✅ **6. Clés `mainStat` des recos.** `mainPicksForSlot` (`translateReco.ts`) écarte une clé absente du registre des
  stats (`STAT_TO_PRIORITY`, toutes les clés de roll) et le signale dans `warnings`
  (`Weapon: "…" — unknown main stat "…" — skipped.`) ; un slot dont aucune clé n'est connue reste ouvert au lieu
  d'être réduit à rien.
- ✅ **7. En-tête « N slots change ».** Il lisait `selectedBuild.upg`, figé au solve ; après Equip l'inventaire relu
  dit 0 mais l'en-tête gardait l'ancien nombre. Il lit `equipPlan.moving` (`buildDiff` sur l'inventaire courant, la
  règle d'Equip et du bandeau).
- ✅ **8. Cycles de `plan.ts`.** Kahn s'arrête sur un cycle et sur tout ce qui en dépend ; tout le reste était marqué
  cyclique. Les restes passent par Tarjan (`stronglyConnected`) : seuls les membres d'une composante de plus d'une
  entrée sont `cyclic`, et les composantes s'ordonnent entre elles (Kahn sur le graphe condensé, départage par la
  position de leur premier membre), donc une entrée qui attend un cycle vient juste après lui. Rien ne change pour
  les entrées que Kahn émettait déjà.
- ✅ **Docs.** `docs/solver.md` / `wiki/Solver.md` (score non arrondi, départage et plafond de variantes au tas, cause
  `"brokenSets"`, erreur sans résultats partiels, pin en SOLVE CP avec priorité, en-tête relu, état vide de la
  table), `docs/reference.md` / `wiki/Engine-Reference.md` (formule du Score sans `round`, pin des branches 1 et 2,
  lignes des tests worklist et translateReco).
- ✅ **Tests** (un par point, chacun rouge sans son correctif) : `solver.test.ts` (score non arrondi ; ex aequo
  ordonnés par `pieceUids` quel que soit l'ordre de push ; `compareBuilds` ; tas plafonné : une combinaison distincte
  survit au top-K, une meilleure variante remplace la pire de sa signature, même résultat que tas libre + collapse
  quand rien n'est perdu), `solveChunk.test.ts` (`brokenSetsRejected` sur quatre sets sans paire, et 16 − 8 sur A/B),
  `orchestratorFailure.test.ts` nouveau (pool de faux workers, précalcul stubbé : `error` puis `onerror` sans
  `onResult` ni résultat tardif, `cancel()` flushe encore, cause `"brokenSets"` posée ou non), `cpPin.test.ts` nouveau
  (contrat réel, Top% 1 : la pièce portée survit en CP avec et sans priorité, pas en Score ; un plafond de stat
  neutralise l'élagage de dominance, qui retire à bon droit une pièce dominée), `translateReco.test.ts` (clé inconnue
  écartée et signalée, slot laissé ouvert), `buildDiff.test.ts` (0 slot changé sur l'inventaire relu après Equip),
  `worklistPlan.test.ts` (cycle a↔b plus c qui attend a : `cyclic` = {a, b}, ordre a, b, c).
  `npm run typecheck` : dernière ligne `> tsc --noEmit` (sans erreur) ; `npm test` : `Tests  530 passed (530)` côté
  renderer (core 154, desktop 157) ; `npm run lint` : `0 errors and 1 warning potentially fixable with the --fix
  option.` (28 avertissements, les mêmes qu'avant le lot).
- ⏳ **Vu en passant, laissé.** La colonne `upg` de la table et l'`upg` de l'entrée « + Worklist » lisent encore
  l'`upg` du solve, périmé après Equip comme l'était l'en-tête. La cause du point 4 (l'élagage Top% ne protège pas les
  sets formables quand les sets cassés sont refusés) est expliquée à l'écran, pas corrigée. Les compteurs de tests de
  `docs/reference.md` étaient déjà périmés, non recomptés.
- ⏳ **À voir en jeu par Sevih.** Un solve « Allow broken sets » off à Top% bas qui rend 0 build affiche le nouveau
  message ; après Equip, l'en-tête du build sélectionné tombe à « 0 slots change ».

### 💎 Gemmes en SOLVE CP allouées par apport de CP (M8), un seul allocateur (2026-10-19)
- ✅ **Pourquoi.** M8 de `docs/todo.md` (revue 2026-10, chiffres « non relancés »). En SOLVE CP sans priorité, les
  gemmes étaient prises dans l'ordre des poids CP linéaires (`cpStatWeights` : un bump `ROLL_NORMS` par stat, l'ATK %
  pesé sur un bump d'ATK plat), alors que le CP n'est pas linéaire (l'ATK compose, le CHC plafonne). Et
  `allocateGems` / `aggregateGemDelta` refaisaient le même parcours de `pickOrder`, appelés l'un après l'autre par
  variant dans `prepareContext`. Rejeu du script `t8` de la revue (Ame, 2000065, cinq copies de sept gemmes lv6),
  après G2 : **avant** `greedy delta {"pct":{"dmgReduce":24}} CP 34643` contre `optimum {"atkPct":12,"dmgReduce":9.6}
  CP 35044` ; même écart sur 2000001 (27 869 / 27 968) et 2000110 (31 641 / 31 735). L'écart n'avait pas bougé.
- ✅ **Un seul allocateur.** `allocateGems` rend `{ alloc, delta }` (`GemAllocation`, ex-`CappedAllocation`) : c'est
  `allocateGemsCapped` sans plafond (CHC courant à −∞), même parcours, même `null` sans gemme ni emplacement.
  `aggregateGemDelta` est supprimé ; `engine.ts` fait un appel par nombre d'emplacements du talisman et range les deux
  moitiés dans `gemAllocByTalismanSlots` / `gemDeltaByTalismanSlots`.
- ✅ **Par CP marginal.** `allocateGemsByCp(scored, ts, ee, cpOf)` (`gems.ts`) : gemme par gemme, celle qui monte
  le plus le CP de la composition de référence avec les gemmes déjà posées, réévalué à chaque pas (plafond CHC
  compris, puisque c'est le vrai calcul du CP). Référence = celle qui notait déjà les gemmes : le build équipé du
  héros (`equipped`, son évaluateur CP et son talisman, hissés dans `prepareContext` et partagés avec
  `cpStatWeights`), composé avec le delta en cours. Candidates = `pickOrder` (pas de priorité négative, pas de
  remplissage sous un `max`), chaque id pesé une fois par pas, égalité → ordre de `pickOrder` ; une gemme sans apport
  de CP n'est posée qu'une fois les utiles épuisées, dans l'ordre de `pickOrder`. Branché seulement en SOLVE CP sans
  priorité (là où l'ordre venait des poids CP) ; une priorité explicite garde l'allocation par priorité, comme le
  disait déjà le code. Le coût reste par solve : (emplacements × ids distincts) compositions par variant.
  `allocateGemsReachingCap` et l'anti-overshoot `allocateGemsCapped` (`CRC_OVERSHOOT_CEIL`) ne bougent pas.
- ✅ **Après.** `t8` : `greedy delta {"pct":{"dmgReduce":9.6,"atkPct":12}} CP 35044` = l'optimum ; 2000001 → 27 968,
  2000110 → 31 735, les deux à l'optimum aussi. Temps : `solveChunk.test.ts` / `cpPrune.test.ts` inchangés (solve CP
  à 1 ms avant et après ; ils montent leur contexte à la main, sans `prepareContext`) ; `prepareContext` du cas `t8`
  (moyenne sur 200) 0,06 → 0,10 ms.
- ✅ **Tests.** `apps/renderer/test/gemFill.test.ts`, nouveau bloc « SOLVE CP without priority — gems by marginal
  CP » sur le contrat réel de `data/derived` : le cas de `t8` (inventaire construit, Ame) → CP de l'allocation égal au
  meilleur des 462 multiensembles de 5 gemmes énumérés, soit 3 ATK % + 2 réduction de dégâts (les 35 044 de la revue,
  composés là au niveau 100 9★ ; la composition du moteur donne d'autres totaux, même optimum) ; CHC à 94 % avant
  gemmes → `[CHC, CHC, DEF %, CHC, CHC]` (deux gemmes crit atteignent le plafond, la DEF % passe avant les crit
  inutiles ; l'ancien ordre posait cinq crit et laissait la DEF %). Tests d'`allocateGems` / delta de `solver.test.ts`
  et `gemFill.test.ts` passés sur la nouvelle forme. `npm run typecheck` → `> tsc --noEmit` ; `npm test` →
  `Duration  1.78s (transform 2.50s, setup 0ms, import 4.34s, tests 2.05s, environment 4ms)` (512 tests renderer) ;
  `npm run lint` → `0 errors and 1 warning potentially fixable with the --fix option.` (28 avertissements, les mêmes
  qu'avant).
- ✅ **Docs.** `docs/solver.md` § 5 et § priorité, `docs/reference.md` (pré-agrégation, fallback SOLVE CP),
  arborescences, et leurs miroirs `wiki/Solver.md` / `wiki/Engine-Reference.md`. M8 sorti de `docs/todo.md`.
- ⏳ **Laissé.** Le glouton n'est pas prouvé optimal en général (il l'est sur les trois héros de `t8`) ; l'anti-
  overshoot par combo (`allocateGemsCapped`, combo au-delà de 102 % de CHC) repasse par l'ordre de `pickOrder`, donc
  par les poids linéaires, comme demandé ; SOLVE CP avec priorité explicite inchangé. Côté Sevih : un SOLVE CP sans
  priorité sur un vrai compte, pour voir les gemmes proposées.

### 🔄 Synchro des données — cache complet vérifié, octets non JSON refusés, échecs d'écriture rapportés, une sync à la fois (2026-10-19)
- ✅ **Pourquoi.** Item « data-sync » de `docs/todo.md` (revue 2026-10), le reste laissé par le lot du mode CHECKOUT
  (`55798f5`, prérequis vérifié). Dans `apps/desktop/src/data-sync.ts` : `derivedReady` ne testait que
  `characters.json`, un cache à moitié présent passait pour prêt (`fresh`, repli `offline`) ; en REPO, `compact`
  rendait les octets bruts quand le parse échouait, donc une réponse 200 qui n'est pas du JSON (page d'erreur) était
  écrite telle quelle ; un `writeAtomic` qui levait sortait de `syncGameData` (docstring « Never throws ») et pouvait
  laisser `data/derived` à moitié écrit ; rien n'empêchait la sync manuelle (`/api/data/sync`) de chevaucher celle
  du lancement.
- ✅ **Cache complet.** `cacheComplete` : les 20 fichiers de `solver-files.json` (la liste unique du lot CHECKOUT)
  présents, sinon pas prêt — REPO ne répond plus `fresh` (ni au même SHA ni au même hash) et télécharge tout, hors
  ligne c'est `unavailable` au lieu d'`offline`. En CHECKOUT, la porte « même hash → `fresh` » exige aussi un cache
  complet (elle ne le testait pas du tout) ; rien d'autre du mode CHECKOUT n'a bougé.
- ✅ **Octets non JSON refusés (REPO).** Après le téléchargement, chaque table est parsée et recompactée avant toute
  écriture ; un échec → `refused()` « <fichier> downloaded from outerpedia is not valid JSON; keeping the cached
  data » (`unavailable` sans cache), rien d'écrit, SHA non enregistré. `version.json` passait déjà par
  `schemaRefusal`, qui refuse un corps illisible ; `compact` ne reçoit plus que ce corps-là.
- ✅ **Écriture en deux temps, échecs rapportés.** `commitFiles` remplace le `writeAtomic` local (les deux modes et
  la réécriture du tampon de version) : tous les corps en `.tmp` voisins d'abord, puis les renommages, `version.json`
  en dernier ; une erreur → les `.tmp` restants supprimés, « could not write <fichier> to the game data folder
  (<code>); keeping the cached data » par `refused()` (`unavailable` sans cache complet), SHA non enregistré, aucune
  exception. Un échec à l'étape `.tmp` laisse l'ancien cache entier ; un échec de renommage (rare : cible occupée)
  peut laisser des tables déjà remplacées, mais l'ancien `version.json` fait retenter la sync au lancement suivant.
- ✅ **Une sync à la fois.** `syncGameData` n'est plus `async` : il garde la promesse en cours (`inFlight`) et la
  rend telle quelle à un appel qui arrive pendant la sync (ses options ignorées, `force` compris), la relâche quand
  elle se règle ; un `.catch` final change toute exception restante (`mkdirSync`, `writeShaState`) en statut
  `error`, ce qui rend la docstring vraie.
- ✅ **Docs.** `docs/reference.md` § 3.1 et `wiki/Engine-Reference.md` : le mode repo refuse un artefact non JSON,
  le repli hors ligne exige un cache complet ; un paragraphe commun aux deux modes dit le cache complet, l'écriture
  en deux temps, le statut `error` et la sync unique. Item « data-sync » sorti de `docs/todo.md`, avec sa section
  « Revue 2026-10 — divers » restée vide.
- ✅ **Tests.** `apps/desktop/test/data-sync.test.ts` (réseau stubé ; `writeFileSync` de `node:fs` défaillant à la
  demande par `vi.mock`, un dossier en lecture seule n'étant pas portable sur la CI Windows) : cache sans
  `sets.json` → REPO au même hash `synced`, au même SHA `synced`, hors ligne `unavailable`, CHECKOUT au même hash
  `synced` ; une table servie en `<html>` (force ou non) → refus qui la nomme, toutes les tables, `version.json` et
  le SHA intacts, aucun `.tmp` ; `sets.json`, puis `version.json` (après toutes les tables) qui ne s'écrivent pas →
  `error` qui les nomme, ancien cache entier, aucun `.tmp` ; le tampon de version non réécrit → `error`, SHA non
  enregistré ; CHECKOUT, même règle ; sans cache et rien d'inscriptible → `unavailable`, dossier vide ; deux appels
  simultanés → même promesse, un seul appel à l'API GitHub et 19 tables téléchargées une fois ; le verrou relâché
  après. L'ancien test « a write failure mid-sync » (renommage bloqué par un dossier) attendait une exception : il
  attend désormais `error` nommant `trust-character.json`, l'ancien hash et aucun `.tmp`. Contre-épreuve :
  `derivedReady` remis sur `characters.json` seul et le verrou retiré → `Tests  5 failed | 91 passed (96)`, code
  restauré. `npm run typecheck` : dernière ligne `> tsc --noEmit` (renderer), sans erreur ; `npm test` : core
  `Tests  154 passed (154)`, desktop `Tests  157 passed (157)`, renderer `Tests  510 passed (510)` ;
  `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)`, aucun dans les fichiers touchés (`eslint` sur eux seuls :
  rien).
- ✅ **Repéré hors périmètre** (rien touché) : la graine du premier lancement (`apps/desktop/src/main.ts`) ne copie
  encore le `data/derived` embarqué que si `characters.json` manque — un cache à qui manque une autre table n'est
  pas réensemencé (la sync la retélécharge désormais, sauf hors ligne).
- ⏳ Sevih : rien ; le comportement visible ne change que sur un cache incomplet ou une écriture qui échoue.

### 🖥️ Bureau — écritures atomiques du serveur, `/api/*` inconnue en 404, `img-cache` revalidé (2026-10-19)
- ✅ **Pourquoi.** Item « Desktop » (`docs/todo.md`, revue 2026-10). Cinq écritures passaient par `writeFileSync`
  direct : un lecteur pouvait voir un fichier à moitié écrit (les stat-locks, `user_item.json` réécrit par Equip et
  relu aussitôt par l'app, la config BepInEx du plugin, le SHA suivi, le marqueur de préchargement des images). Une
  URL `/api/…` inconnue tombait dans le repli SPA (`server.ts` en prod, Vite en dev) et recevait `index.html` en 200.
  Une image du cache disque était servie pour toujours, jamais revalidée contre R2.
- ✅ **Écritures.** Nouveau `apps/desktop/src/atomic-write.ts` : `writeAtomic(file, data)` crée le dossier, écrit un
  `.tmp` voisin (pid + compteur) puis `renameSync` ; en cas d'échec le `.tmp` est supprimé et l'erreur relancée,
  l'ancien fichier intact. Sans Electron (Vite le charge). Utilisé par `api-handler.ts` (stat-locks, `user_item.json`),
  `steam-capture.ts` (`writePluginConfig`), `repo-source.ts` (`writeShaState`, qui crée désormais son dossier),
  `main.ts` (`prefetch.json`) et `img-cache.ts`, dont la copie locale disparaît. `data-sync.ts` garde la sienne (G23).
- ✅ **404.** Fin de `createApiHandler` : toute URL commençant par `/api/` non reconnue (route inconnue ou méthode non
  servie) répond 404 `{ "error": "unknown endpoint" }` en JSON et rend `true` ; prod et dev en même temps puisque les
  deux passent par ce handler. `/api` seul et les préfixes voisins (`/apix/…`) restent au repli SPA.
- ✅ **Revalidation d'`img-cache`.** Politique de la rédaction du lot : une image du cache disque plus vieille que
  7 jours (`REVALIDATE_AFTER_MS`, sur le mtime) est servie tout de suite depuis le cache, puis revalidée en
  arrière-plan par une requête conditionnelle — `If-None-Match` sur l'ETag gardé dans
  `<cacheDir>/image-etags/<rel>.etag` (hors de `images/`, donc jamais servi par `/img/*`), sinon `If-Modified-Since`
  sur le mtime. 304 → mtime rafraîchi ; 200 → image et ETag réécrits atomiquement ; erreur réseau ou autre statut
  (404 compris) → rien, l'image en cache reste servie. Une `Map` des revalidations en vol par fichier : jamais deux à
  la fois pour la même image. `fetchR2` rend l'ETag ; le premier téléchargement (`serveAndCache`) et le préchargement
  (`prefetchImages`) le stockent via `cacheImage`. Les sprites embarqués et le checkout local ne sont pas concernés.
  Docstring de la cascade, `docs/architecture.md` et `wiki/Architecture.md` mis à jour.
- ✅ **Tests.** `atomic-write.test.ts` (dossier créé et fichier complet sans `.tmp`, remplacement d'un fichier
  existant, échec du rename → erreur et pas de `.tmp`) ; `api-handler.test.ts` gagne le 404 JSON (route mal
  orthographiée, POST inconnu, méthode non servie, `/api/`) et la non-capture de `/api` et `/apix/…`, les routes de
  l'ancienne source émulateur passent de « repli » à 404, et l'écriture des stat-locks (fichier complet, pas de
  `.tmp`) ; `img-cache-revalidate.test.ts` (`fetch` stubé, `settleImgRevalidations` pour attendre l'arrière-plan) :
  frais → aucune requête, vieux + 304 (`If-None-Match`, mtime rafraîchi), vieux sans ETag → `If-Modified-Since`,
  vieux + 200 (ancien octet servi, cache et ETag réécrits, pas de `.tmp`, plus de revalidation ensuite), vieux +
  réseau en panne (servi, fichier et mtime inchangés), trois requêtes simultanées → une seule revalidation, ETag du
  premier fetch hors de `images/`. `npm run typecheck` → `> tsc --noEmit` sans erreur ; `npm test` → `Tests  154
  passed (154)`, `Tests  144 passed (144)`, `Tests  510 passed (510)` ; `npm run lint` → `✖ 28 problems (0 errors,
  28 warnings)` (aucun dans les fichiers du lot).
- ⏳ Rien pour Sevih au-delà de la release habituelle. Repéré hors périmètre : le repli `.png` → `.webp` met en cache
  sous le nom `.webp`, si bien qu'une requête `.png` suivante repasse par R2 (deux fetchs) au lieu de trouver le
  cache.

### 🔌 Plugin Steam en repli — `GiftList` sans `PVPStart`, écritures dans l'ordre d'arrivée, ré-import sur tous les fichiers lus (2026-10-19)
- ✅ **Pourquoi.** Item « Plugin Steam en repli » (`docs/todo.md`, revue 2026-10). Trois défauts : le repli par forme
  (`CaptureByShape`, quand le hook de chemin a été inliné) nommait `user_gift` tout objet portant `GiftList`, or la
  réponse de début de PvP en porte une aussi (celle de l'adversaire) → ses geas écrasaient ceux du joueur ; chaque
  capture partait par `ThreadPool.QueueUserWorkItem` puis prenait un verrou, sans garantie d'ordre (deux `/user/item`
  rapprochés pouvaient s'écrire dans le désordre, le plus ancien gagnant) ; le suiveur Steam ne ré-importait que sur
  le mtime de `user_item.json` alors que l'import lit aussi `user_character`, `user_gift`, `user_archive` (un niveau
  de héros ou de geas gagné sans nouvel inventaire n'était pas repris).
- ✅ **Forme.** Vérifié dans le client décompilé : à la profondeur 1, `GiftList` n'existe que dans `CWebRES_GiftInfo`
  (seul champ) et `CWebRES_PVPStart` (avec `TicketData`, `CharList`, `ItemList`, `MatchUserArchiveCompleteCount`,
  `Var1`…`Var5`) ; `CWebResponseBase`/`CWebResponseError` n'ajoutent que `status`, `code`, `message` ; les autres
  porteurs (`WSPvpMatchUserData`, `WSWorldBossRankingSaveDeckData`) sont imbriqués, donc invisibles au relevé des clés
  de premier niveau. `NameByShape` (`tools/capture-steam/src/Plugin.cs`) ne rend plus `user_gift` que pour `GiftList`
  sans aucune de `TicketData`/`CharList`/`ItemList`, commentaire qui nomme les deux classes.
- ✅ **Écritures.** `Sink` tient une `BlockingCollection<Action>` (net472) vidée par UN thread de fond
  (`Drain`, `IsBackground`) ; les hooks ne font qu'enfiler (capture par chemin, repli par forme, heartbeat initial),
  le verrou `Gate` et le `ThreadPool` disparaissent. Écriture atomique (`.tmp` + `File.Replace`) et dédoublonnage
  du repli (`LastHash`) inchangés.
- ✅ **Ré-import.** `captureStatus` (`apps/desktop/src/api-handler.ts`) renvoie `mtimes` (`user_item`,
  `user_character`, `user_gift`, `user_archive`, null si absent) en plus de `userItemMtime`, gardé pour la ligne
  « dernière capture » de Home (`HomeScreen.tsx`). `CaptureStatus` (`apps/renderer/src/capture.ts`) suit ;
  `snapshotFollower.ts` compare une clé des quatre mtimes et ré-importe quand l'une change, tant qu'un
  `user_item.json` existe (sans inventaire l'import n'a rien à charger ; son arrivée change la clé de toute façon).
- ✅ **Docs.** `tools/capture-steam/README.md` (repli `GiftList`, écrivain unique dans l'ordre d'arrivée) et
  `wiki/Capture-Pipeline.md` (idem + les quatre fichiers qui déclenchent le ré-import) ; pas de pendant dans `docs/`.
- ✅ **Tests.** `snapshotFollower.test.ts` gagne « `user_character` seul change → ré-import » et « rien ne change →
  pas de ré-import » ; `api-handler.test.ts` gagne les mtimes des quatre fichiers (`utimesSync`, absent → null) et
  le statut vide les inclut. `npm run typecheck` → `> tsc --noEmit` sans erreur ; `npm test` → `Tests  510 passed
  (510)` ; `npm run lint` → `✖ 28 problems (0 errors, 28 warnings)` (aucun dans les fichiers du lot) ;
  `npm run capture-steam:build` → `0 Erreur(s)`, `0 Avertissement(s)` (jeu et BepInEx présents sur le portable).
- ⏳ Sevih : test en jeu (une session avec un PvP lancé, `user_gift.json` garde ses geas — le repli ne sert que si
  le hook de chemin est inliné, donc vérifier surtout que la capture normale reste saine) ; le plugin reconstruit
  part avec la prochaine release (version du plugin inchangée, `0.1.0`).

### ⚡ Inventory — qualité et texte de recherche précalculés, un seul calcul de qualité (2026-10-19)
- ✅ **Pourquoi.** Items « Perf Inventory », « Optims mineures Inventory » (`[~]`, report « tant que le profilage ne
  le réclame pas » levé le 18/10) et puce qualité de « Duplications » (`docs/todo.md`). `matchesFilters`
  (`screens/InventoryScreen.tsx`) reconstruisait la chaîne de recherche et rappelait `computeQuality` pour chaque
  pièce à chaque frappe, la passe de disponibilité des chips le rappelait encore par pièce, et la règle de qualité
  existait en trois exemplaires : `computeQuality` de `design/GearDetail.tsx` (exporté), sa copie privée dans
  `design/ResultGearDetail.tsx`, `gearPieceQualityTier` de `lib/quality.ts` (filtre de qualité du solveur, Home).
- ✅ **Une règle.** `lib/quality.ts` gagne `qualityScore(slot, star, reforgeCount, ticks)` → `QualityScore`
  (`current`, `max`, `pct`, `tier`) ou null (talisman/EE, pièce sans sous-stats ou sans étoile ; cap 14 + 1 par
  reforge, paliers inchangés via `qualityTierFromScore`), et `gearPieceQuality(p)` qui l'applique à un `GearPiece`
  (ticks `s.ticks ?? 0`). `gearPieceQualityTier` garde sa signature et lit `gearPieceQuality`. Les deux
  `computeQuality` sont supprimés.
- ✅ **Précalcul.** `UiPiece` (`design/adapter.ts`) gagne `quality: QualityScore | null` et `searchText` (nom, slot,
  rareté, libellés des mains, clés des sous-stats, en minuscules — la composition de l'ancienne chaîne `hay`), remplis
  une fois par `toUiPiece`. `matchesFilters` lit `p.quality` et `p.searchText`, la passe de disponibilité lit
  `p.quality`, `GearDetailBody` et `ResultGearDetail` lisent `piece.quality`. Le tri de l'Inventory ne lit pas la
  qualité (étoiles, enhance/reforge/tier, sous-stat) : rien à y changer. Toutes les `UiPiece` sortent de
  `toUiPiece` (Inventory, Builds, Worklist, Builder, y compris les pièces projetées, adaptées après projection) : pas
  de qualité périmée possible. Une seule nuance théorique : l'ancien chemin UI comptait un tick absent pour 1
  (`lv = ticks ?? 1`), la règle unique pour 0 comme le solveur ; `parse.ts` pose `ticks` sur toute sous-stat, l'écart ne se
  produit donc pas. Liste « À NE PAS toucher (Inventory) » respectée (virtualisation, `charsByUid`, auto-prune,
  `memo` de `GearTile`, re-seed du draft intacts).
- ✅ **Mesure.** Banc jetable (non commité) sous vitest, 1 000 pièces synthétiques (8 slots, 4 sous-stats), chips
  de qualité Good/Excellent/Perfect actifs, sept frappes « c » → « critdmg » rejouées 400 fois : ancien
  `matchesFilters` (copie verbatim) 144 à 149 µs par passe de `filtered`, nouveau 23 à 27 µs (≈ ×6), même nombre de
  pièces retenues. Le coût passe dans `toUiPiece`, une fois par changement d'inventaire.
- ✅ **Tests.** Nouveau `apps/renderer/test/quality.test.ts` (7) : règle (talisman/EE → null, sans sous-stats ou
  sans étoile → null, paliers 50/70/85/100 %, cap relevé par les reforges), `gearPieceQualityTier` sur la même règle,
  `toUiPiece` (qualité et `searchText`), et égalité des trois anciens chemins (copies verbatim gardées dans le test)
  avec le nouveau sur chaque item de `data/derived/equipment.json` × 20 dispositions de ticks/reforges, plus une
  pièce 6★ ascendée construite à la main (21/23, Excellent).
- ✅ **Vérifications.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` : core 154,
  desktop 131, renderer 508 verts (501 + 7), dernière ligne `Duration 1.75s (transform 2.32s, setup 0ms, import
  4.29s, tests 1.99s, environment 4ms)` ; `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)`, dernière ligne
  ``0 errors and 1 warning potentially fixable with the `--fix` option.``, sortie 0, même total qu'avant le lot.
- ⏳ **À contrôler par Sevih.** Inventory : recherche (nom, slot, stat), chips de qualité et leur disponibilité, tri,
  panneau de détail (score et barre de qualité) ; carte de résultat du Builder (qualité). Laissé : `QUALITY_TONE`
  existe encore en deux copies (`GearDetail.tsx`, `ResultGearDetail.tsx`), hors du périmètre (règle de calcul
  seulement) ; la table des tests de `wiki/Engine-Reference.md` ne liste pas `quality.test.ts` (table partielle).

### 🐛 Builds, Settings, Home — stat-locks migrés et validés, Reset qui garde le tri, plus d'`alert`/`confirm`, une règle de workers (2026-10-19)
- ✅ **Pourquoi.** Items « Stat-locks (debug) : `renameLegacyStatKeys` non appliqué », « Reset (Builds) », « `window.alert` /
  `confirm` bloquants », « Casts JSON non validés », « `useMemo(…, [])` comme lire une fois » et puces Builds
  (stat-locks) / SettingsModal de « Effets de bord dans des updaters `setState` » (`docs/todo.md`). Le fichier
  `/api/stat-locks` était casté sans validation ni migration des clés : `data/stat-locks.json` (9 héros) porte encore
  `crc`, `chd`, `res`, `dmgRed`, donc les locks de taux crit, dégâts crit, résistance et réduction ne correspondaient
  jamais. Le debounce d'écriture était armé dans l'updater de `setLocksRaw` (doublé en StrictMode) ; Reset du filtre
  Builds repassait le tri par rang au tri par CP ; Settings bornait les workers aux cœurs et `resolveWorkerCount` à
  64 (deux règles) ; Settings ouvrait dix boîtes natives bloquantes ; `readManualFiles` prenait tout JSON portant
  `ItemList`/`CharList` sans vérifier que c'est une liste.
- ✅ **Stat-locks.** Nouveau `apps/renderer/src/lib/statLocks.ts` (pur) : `LockEntry`/`LocksMap` y déménagent et
  `parseStatLocks(data: unknown)` valide la lecture — hors objet → `{}` ; entrée non objet écartée ; entrée riche
  (`stats` présent) : `name`/`charId`/`level` gardés s'ils ont le bon type (sinon `"?"`/0/0) ; forme ancienne nue
  enveloppée comme avant ; dans les deux cas `renameLegacyStatKeys` puis seules les valeurs numériques finies
  restent, et une entrée sans aucun lock est écartée (l'app n'en écrit jamais : déverrouiller la dernière stat
  supprime l'uid). Dans `useStatLocks` (`screens/BuildsScreen.tsx`) : garde `alive` sur le `fetch` du montage, et
  `setLocks` résout l'updater contre une ref de la dernière carte puis appelle `setLocksRaw(next)` et arme le
  debounce hors de tout updater (un updater qui rend la même carte ne programme plus d'écriture). Le fichier n'est
  pas réécrit d'office : ses clés passent au nom canonique à la prochaine écriture (un lock basculé).
- ✅ **Reset (Builds).** `setF({ …, byRank: f.byRank })` : le Reset vide recherche, éléments, classes et filtre de
  locks, le tri choisi reste.
- ✅ **Workers.** `clampWorkerCount(n, cores = availableCores())` exportée par `lib/solver/orchestrator.ts` :
  [1, min(cœurs, 64)] ; `availableCores()` = `hardwareConcurrency`, 4 à défaut. `resolveWorkerCount` l'applique à
  l'override (une valeur persistée au-delà des cœurs, ex. 20 sur 8 cœurs, est ramenée à 8 — avant : 20) et au défaut
  (`cœurs − 1`) ; la saisie de Settings (`SolverPane`) l'applique aussi et lit les cœurs par `availableCores()`.
  `docs/architecture.md`, `docs/solver.md` et leurs miroirs `wiki/` le disent.
- ✅ **Settings sans boîte bloquante.** `SettingsModal` gagne une prop `onStatus` (l'App passe `setStatus`, seul
  changement de `App.tsx`) : échecs d'export, d'import, de wipe et de retrait du plugin, et compte rendu de l'import
  vont à la barre de status. La sync n'a plus de message propre : `syncGameData` de l'App écrivait déjà
  `describeDataSync` dans la barre. Les deux confirmations (Wipe captured data, Remove plugin) passent par
  `useConfirmClick` : le premier clic arme le bouton, libellé « Click again to confirm », un second clic dans les
  4 s (`CONFIRM_WINDOW_MS`) lance l'action, sinon il se désarme (minuteur nettoyé au démontage) — changement
  d'interface demandé. Gardes de démontage (`useMountedRef`, même forme que dans `WorklistScreen.tsx`) sur
  `setLoading` après le probe, `setWorking` après le retrait du plugin et `setSyncing` après la sync (la sync est
  remontée dans `SettingsModal`, `DataPane` reçoit `onSync`).
- ✅ **Import manuel.** `readManualFiles` (`data.ts`) vérifie `Array.isArray` sur `ItemList`/`CharList` et renvoie
  `<fichier>: ItemList is not a list` (resp. `CharList`), que l'App affiche déjà en « Manual import failed — … ».
- ✅ **HomeScreen.** Les compteurs de bibliothèque sont lus par `useState(() => …)` au lieu de `useMemo(…, [])`.
- ✅ **Tests (renderer +12).** `test/statLocks.test.ts` (6 : `crc`/`chd`/`res` → `critRate`/`critDmg`/`effRes` dans une
  entrée riche, forme nue migrée, clés canoniques intactes, seules les stats numériques finies, entrées écartées,
  fichier non objet) ; `test/workerCount.test.ts` (+5 : override au-delà des cœurs ramené, défaut plafonné à 64 sur
  256 cœurs, `clampWorkerCount` borné à [1, cœurs], plafond 64, lecture de `hardwareConcurrency`) — les cas « override
  20 sur 8 cœurs = 20 » et « 9999 sur 8 cœurs = 64 » deviennent 6/8 et 9999 sur 128 cœurs ; `test/manualImport.test.ts`
  (+1 : `ItemList` objet, `CharList` null).
- ✅ **Vérifications.** `npm run typecheck` : dernière ligne `> tsc --noEmit` (sortie 0) ; `npm test` : core 154,
  desktop 131, renderer 501 verts (489 + 12), dernière ligne `Duration 1.06s (transform 2.33s, setup 0ms, import
  4.19s, tests 674ms, environment 4ms)` ; `npm run lint` : `✖ 28 problems (0 errors, 28 warnings)`, sortie 0, mêmes
  avertissements qu'avant dans chaque fichier touché (comparés par `git show HEAD:<fichier> | eslint --stdin`).
- ⏳ **À contrôler par Sevih.** Settings → Export / Import / Sync / Remove plugin / Wipe : aucune boîte bloquante, le
  double clic de Remove et Wipe, les messages dans la barre de status (elle reste derrière le fond flouté de la
  modale : lisible en la fermant) ; Reset du filtre Builds en tri par rang. Laissé : la table des tests de
  `docs/reference.md` / `wiki/Engine-Reference.md` (ligne `workerCount` mise à jour, mais le total « 300 tests » et
  les fichiers absents, dont `manualImport` et `statLocks`, datent d'avant) ; `data/stat-locks.json` garde ses clés
  anciennes jusqu'à la prochaine écriture.

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

## [1.23.0] — 2026-10-30

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.22.0] — 2026-10-30

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.21.0] — 2026-10-30

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.20.0] — 2026-10-29

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.19.2] — 2026-10-29

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.19.1] — 2026-10-29

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.19.0] — 2026-10-29

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.18.0] — 2026-10-29

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.17.0] — 2026-10-28

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.16.0] — 2026-10-28

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.15.0] — 2026-10-23

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.14.0] — 2026-10-22

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.13.0] — 2026-10-22

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.12.0] — 2026-10-22

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.11.1] — 2026-10-20

_(rien en attente — les nouvelles entrées de session se mettent ici)_

## [1.11.0] — 2026-10-19

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
