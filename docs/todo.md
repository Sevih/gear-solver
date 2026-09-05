# TODO — backlog gear-solver

> **Tâches ouvertes uniquement.** Ce qui est **livré** vit dans [changelog.md](changelog.md)
> (journal de session + items clôturés) et l'historique git ; les jalons dans [roadmap.md](roadmap.md).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> `[ ]` = à faire · `[~]` = partiellement fait (le détail livré est dans le changelog).
> **0 🔴 ouvert** (l'audit Builder 2026-07-03 — 2 🔴, 3 cas limites, 5 perfs 🟠 + nits ⚪ —
> est entièrement livré ; cf. changelog).

---

## Reste à faire

### 🟢 Ratings offensifs — après la colonne « meilleur skill » (2026-09-05)
- [ ] 🟢 **DPS de rotation pondéré par les cooldowns** — `dmgs` = hit du meilleur skill × SPD,
      pas une rotation. La donnée damage d'outerpedia porte déjà `levels[].cool` / `startCool`
      par skill : un `bestSkill`-like « facteur moyen par tour » (S1 filler + S2/S3 quand
      dispo) est calculable côté générateur. À faire dans le pipeline (nouveau champ), jamais
      en parsant localement.
- [ ] ⚪ **DoT dans le meilleur hit** — assumé non modélisé (Gnosis Beth sous-estimée) ; ne
      traiter que si le moteur damage expose un facteur DoT par skill comparable au hit direct.

### 🟢 Tests manquants — audit Builder (2026-07-03)
- [ ] 🟢 **Crit-cap slow path de bout en bout** — rien ne teste le trigger `wantCritCap`
      + recompose dans `solveChunk` (le chemin par-combo `allocateGemsReachingCap` +
      `gemDeltaEquals` + le memo `capAllocCache`).
- [ ] 🟢 **Flux orchestrateur** — cancel / supersede / `solveId` anti-stale /
      `workersDone === activeChunks` / crash worker (`onerror` → cancel) / flux
      `estimate` (id anti-stale, null-on-error) : aucun test, et c'est là que vivaient
      les bugs corrigés par l'audit (cf. changelog).

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

### 🟡/⚪ UX-cohérence & nits
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

### Externe — packaging desktop (vérif sur un vrai build, le plumbing existe)
- [~] **Support Mobile et emulateur** — **émulateurs : LIVRÉ** (détection générique via `adb devices` +
      override « Manual device » → tout émulateur rooté marche, plus seulement LDPlayer/MuMu/Nox ; cf.
      changelog — à **valider sur un vrai ému** non-profilé). **Reste : mobile/physique** — bloqué par le
      root (téléphone rooté = ADB USB + cert via module Magisk à câbler ; non-rooté = hors de portée, c'est
      une limite physique pas un manque de code). Le wizard signale déjà « physique pas supporté ».
- [~] 🟢 **Capture no-root** — livré par la **source Steam** (plugin BepInEx `tools/capture-steam/`, cf.
      changelog 2026-09-05) : plus de root, d'émulateur ni de proxy pour les joueurs PC. Le root reste
      requis pour la voie émulateur (redirect iptables + CA système, cf.
      [tools/capture/README.md](../tools/capture/README.md)) — plus de raison d'y investir.
      Validé en jeu le 2026-09-05 (hook principal `Log2InternalWeb` actif, 9 endpoints capturés,
      auto-import OK — cf. changelog). **Reste** : (a) vérifier qu'un compte mobile se lie au client
      Steam (FAQ MAJOR9) avant de le vendre aux joueurs ; (b) tester le chemin « BepInEx absent »
      (download + pose dans le dossier du jeu) sur une install vierge — sur la machine de dev BepInEx
      était déjà là ; (c) mobile physique : toujours bloqué par le root (limite physique, cf. item
      au-dessus).
- [ ] Bake prod du `data/` (`extraResources` → `process.resourcesPath`) · `electron build`/installeur
      lance serveur local + renderer · auto-update contre release signée + feed réels · bouton capture
      natif en packagé (sans `npm run dev`).
- [ ] **Vérif sync repo en prod packagé** — 1er lancement online : seed `data/derived` bundlé →
      sync SHA → download des 19 artefacts solver depuis `Sevih/outerpedia` (sans rebuild) ; images
      peuplent le cache à la demande depuis R2 + préfetch des icônes d'équipement référencées par la
      donnée. Vérifier `/img/*` ne tape R2 que sur miss (127.0.0.1 ensuite) · 2e lancement SHA
      inchangé = instantané · simuler un patch (`OUTERPEDIA_REF` autre branche) · offline cold-cache
      = pas de crash. (Mode REPO déjà smoke-testé hors packaging le 2026-08-12 : download @ 387a58c OK.)

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
