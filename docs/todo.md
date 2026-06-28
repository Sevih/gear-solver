# TODO — backlog gear-solver

> **Tâches ouvertes uniquement.** Ce qui est **livré** vit dans [changelog.md](changelog.md)
> (journal de session + items clôturés) et l'historique git ; les jalons dans [roadmap.md](roadmap.md).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> `[ ]` = à faire · `[~]` = partiellement fait (le détail livré est dans le changelog).
> **0 🔴 ouvert.**

---

## Reste à faire

### 🟠 Perf solver
- [~] **Solver CP trop lent** — diagnostic sur vrai compte : Top% 100 défaut + aucune priorité = **cartésien
      complet** (2,4 G combos, >100 s, `S ≈ P`) ; et un prune **en %** ne suffit pas (30 %/slot = encore 1,25 G).
      **Perf RÉSOLUE** (mesuré sur D.Luna, vrai compte : >100 s → **< 4 s**) : (1) **auto-prune CP-pondéré + budget
      combos** sur les 6 slots gear **+ talisman** — chaque slot classé par le CP qu'une pièce donne dans le build
      courant, `allocateComboBudget` borne `∏ ≤ 8 M` (scalé par Top%) ; (2) **gemmes notées par apport CP**
      (`cpStatWeights`, plus de dmg-red gobées) ; (3) **pin du build courant** (jamais pire que l'équipé) ;
      (4) **défaut Top% → 30** (slider 100 = exhaustif) ; (5) **garde-fou** bandeau si `∏ poolSizes > 50 M`.
      **Reste** : (a) confirmer la **justesse du top-CP** en jeu (≥ build équipé) ; (b) *optionnel* : qualité —
      la notation standalone peut sous-classer un membre de set couplé (garde set-aware) ; (c) *optionnel* : B&B CP exact.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) ·
      **SharedArrayBuffer** pour le flag
      `cancelled` (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings`.

### 🟡 Défauts sûrs & garde-fous solver
- [ ] 🟡 **Défauts qui reflètent le jeu réel** — deux défauts actuels trompent l'utilisateur lambda :
      **(1) Reforge `Off` → `Classic` (+10)** : la norme endgame est le **+10** (le +15 coûte des ressources
      rares), or `Off` note le gear **tel que capturé** (souvent +0/+9) → classement sur un état jamais joué.
      **(2) Equipped scope `All` → appliquer la priorité** : `All` (legacy) laisse le solver **voler
      silencieusement** le gear d'un héros mieux classé ; le défaut sûr respecte le rang (own + free, ou
      `≤ Lower priority`). Voler du gear doit rester un choix **explicite**.
- [ ] 🟡 **Estimer le cartésien AVANT le clic SOLVE** — le bandeau garde-fou (`∏ poolSizes > 50 M`) n'apparaît
      qu'**après** le start (les `poolSizes` arrivent au démarrage du solve). Recalculer l'estimation **côté client
      dès que les filtres changent** → l'afficher avant de lancer, pas en post-mortem (« je clique, j'attends, on
      me dit de baisser Top% »).

### 🟢 Workflow / boucle d'action (lot cohérent)
> Brique de base = **diff par slot** ; accumulée sur N héros = **worklist** ; le « fait » réutilise
> `equipPieces` (Equip build, déjà livré côté Builder) sur le snapshot **local** (jamais d'écriture vers le jeu).

- [~] 🟢 **Diff avant/après par slot (Builder)** — **LIVRÉ** : (1) StatsPanel porte le **Δ numérique signé**
      par axe (en plus du tint vert/rouge) ; (2) la `BottomGearBand` marque chaque **slot qui change** (liseré
      cyan + ligne `← pièce remplacée` / `+ new slot`), définition alignée sur `upg` via une Map `currentLoadout`
      slot→pièce équipée ; (3) header de la band = **`N slots change`** + **`ΔCP ±X`** (`build.cp − currentCp`,
      `currentCp` = `calcBattlePower` du loadout équipé, ajouté à `composition`). Cf. solver.md § BottomGearBand
      / Stats. **Reste (optionnel)** : alimenter la **worklist** ci-dessous avec ce même diff comme rendu de ligne.
- [~] 🟢 **Tab « À faire » (worklist multi-héros)** — **LIVRÉ** : onglet **Worklist** (`screens/WorklistScreen.tsx`)
      + storage `lib/storage/worklist.ts` (blob `gs.worklist`, possédé par App). Bouton **« + Worklist »** dans le
      Builder (à côté d'Equip build) → pousse le **diff par slot** (slots changés only) du build sélectionné ;
      l'écran groupe par héros, chaque changement = **ligne cochable** + bouton **Apply locally** (`equipPieces`
      réécrit le snapshot, jamais le jeu). Les 3 choix de design tranchés :
      - **(a) Contention** — `claimCount` (toUid → nb d'entrées) ⇒ badge **conflict** + « contested » par ligne.
      - **(b) Fraîcheur** — **tout dérivé live de l'inventaire** (pas de snapshot stocké) : `applied` (pièce déjà
        sur le héros → vert), `stale` (toUid absent de l'inventaire → grisé, exclu de l'apply). Self-healing.
        **Auto-prune à chaque refresh d'inventaire** (recapture / reload / apply / sync) : `reconcileWorklist`
        retire les changements faits pour de vrai (pièce désormais sur le héros) + les entrées vidées (App `useEffect[inv]`).
      - **(c) « fait »** — **les deux** : case cochable manuelle (`done`, persisté) **et** `applied` auto-détecté ;
        **Apply locally** = chemin autoritatif qui réécrit le snapshot. Badge tab = changements restants.
      **Reste (optionnel)** : ordre/transaction inter-entrées (appliquer A avant B quand B réutilise le gear de A).
- [ ] 🟢 **Recherche inversée « qui profite de cette pièce ? »** — depuis l'Inventory, sélectionner une pièce
      → liste des héros qui **gagneraient le plus** à l'équiper (Δ CP / score). Flux **inverse** du héros→pièces
      actuel : « j'ai drop une belle pièce, à qui la donner ? » — besoin quotidien non couvert.
- [ ] 🟢 **Suggestions de swap inter-héros** — le solver voit déjà qu'une pièce est « équipée sur un autre héros »
      (badge orange). Pas suivant : « cette pièce sert **mieux** ici que là » → réallocation au niveau **compte**,
      pas par héros isolé. C'est précisément ce qu'un humain n'optimise pas de tête.
- [ ] 🟢 **Exclusion globale de pièces** — clic-droit sur une pièce (Inventory) → **« exclure du solve »** quand
      ses stats sont éclatées (propriété de la *pièce*, pas du héros) → **liste globale persistée**, tous les
      solves la sautent au pool. Distinct du multi-select « Exclude equipped » (par héros). Couche **dure**
      (construction du pool, phase 2) — compose proprement avec l'auto-prune mou (phase 3), ne le casse pas.

### 🟡/⚪ UX-cohérence & nits
- [ ] 🟡 **Home : chiffres cliquables → Inventory filtré** — le dashboard affiche des chiffres **morts**
      (« Poor · 150 », breakdown par slot/set). Les rendre **cliquables = raccourcis de navigation** : clic sur
      « Poor · 150 » → Inventory pré-filtré quality=Poor ; clic sur « Boots · 12 » → Inventory filtré Boots.
      Pas de reco, juste : chaque chiffre est une porte vers l'écran où on agit dessus. Effort faible.
- [ ] 🟡 **Persistance des filtres** : si on a déjà fait une recherche avec un héros, garder les filtres mis en
      place. Évite de devoir se rappeler de tout (« j'avais mis quoi comme réglage ? »).
- [~] 🟡 **`Advices` (tab Builds)** — lot prioritaire + (1)/(2) livrés (`lib/buildAdvice.ts` : caps gaspillés,
      gems vides, upgrade agrégé ; **(1)** bruit Missing supprimé sur persos WIP — `Missing` ne sort que ≤ 2
      slots manquants ; **(2)** ligne agrégée « N pieces below max enhance » (cap +10, +15 si ascended) ;
      cf. changelog). **Reste — (3) lot secondaire** (main off-scaling vs `meta.dmgStat`, basse qualité,
      « 4pc dispo en inventaire ») : nécessite de **passer l'inventaire complet** à `computeAdvice` (thread
      `inventory.gear` + `meta.dmgStat` dans `AdviceInput`) — plus gros changement, différé.
- [~] ⚪ **Optims mineures Inventory (si profilage)** — double virtualisation + fusion des 7 `useMemo`
      d'availability livrées (cf. changelog). **Reste** : `computeQuality` est encore recalculé dans
      `matchesFilters` (chip quality actif) et le panneau de détail — un précalcul partagé (`toUiPiece` /
      map par UID) traverserait la frontière adapter↔quality, différé tant que le profilage ne le réclame pas.
- [ ] ⚪ **Tint doré d'un sub — seuil faux** (`SubstatRow`, `design/GearDetail.tsx`) — `isMax = s.lv >= stars`
      dore un sub quand son LV atteint le nombre d'étoiles, mais le socle d'un 6★ est **4/4/3/3** (un sub
      plafonne vers ~4 ticks, pas 6) → un sub ne devient doré qu'**après 2 reforges dessus**, jamais au
      socle. Le « max » par-sub n'est pas `stars`. À **redéfinir** (vrai cap par-sub) ou **retirer le tint**.
      Purement cosmétique — n'affecte ni la Quality ni le filtre Min quality.

### Persistence
- [~] **Snapshot `data/` versioning** — stamp + expo livrés (`build.mjs` → `version.json` `{ hash, builtAt }`,
      affiché Settings → Data ; cf. changelog). **Reste (différé — touche les caches Builder)** : comparer le
      `hash` au démarrage vs un `gs.data.hash` stocké et, au changement, **invalider/élaguer** les caches
      localStorage (SavedBuild référençant des `pieceUids` disparus, presets). À faire dans la couche storage /
      au boot, hors UI Builder.
- [~] **Equip / Unequip** — méthodes core + endpoint writer + client + **déclencheur Builder « Equip
      build »** livrés (popup de confirmation → `equipPieces` réécrit le snapshot en 1 passe → `refreshInventory` ;
      cf. changelog). **Reste (optionnel)** : un déclencheur côté **Builds** (unequip / assignation par slot).
      → consommé par la **worklist** (§ Workflow) pour le « fait ».

### Externe — Onboarding & packaging desktop (vérif sur un vrai build, le plumbing existe)
- [ ] 🟡 **Onboarding wizard capture (multi-émulateur / mobile)** — le Setup pane est une **checklist
      technique** (ADB / root / cert MITM) qui suppose l'expertise → barrière #1 à l'adoption. Le transformer en
      **wizard linéaire** qui **détecte ce qui est présent** (LDPlayer / MuMu / Nox / mobile USB) et guide étape
      par étape. Couplé à « Support Mobile et émulateur » ci-dessous.
- [ ] **Support Mobile et emulateur** — récupérer les datas peu importe l'émulateur **ou** le mobile.
- [ ] Bake prod du `data/` (`extraResources` → `process.resourcesPath`) · `electron build`/installeur
      lance serveur local + renderer · auto-update contre release signée + feed réels · bouton capture
      natif en packagé (sans `npm run dev`).
- [ ] **Vérif sync repo en prod packagé** (plumbing posé, items 5-10 du plan asset-sync) — 1er lancement
      online : seed `data/derived` bundlé → sync SHA → download tables+buffs → rebuild ; images peuplent
      le cache à la demande + préfetch `ui/`+`equipment/`. Vérifier `/img/*` ne tape jsDelivr/raw que sur
      miss (127.0.0.1 ensuite, 302 outerpedia.com seulement si CDN down) · 2e lancement SHA inchangé =
      instantané · simuler un patch (`OUTERPEDIA_REF` autre branche) · offline cold-cache = pas de crash.

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
