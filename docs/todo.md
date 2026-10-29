# TODO — backlog gear-solver

> **Tâches ouvertes uniquement.** Ce qui est **livré** vit dans [changelog.md](changelog.md)
> (journal de session + items clôturés) et l'historique git ; les jalons dans [roadmap.md](roadmap.md).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> `[ ]` = à faire · `[~]` = partiellement fait (le détail livré est dans le changelog).
> **Décision** = à trancher avant de coder.
>
> Dernier passage : 2026-10-19 — sortis : L1 (fait), L10 (abandonné), le filtre des passifs de skill (fait côté
> contrat), le mode CHECKOUT, le test de forme croisé et M3 ; section packaging requalifiée (installeur, données
> embarquées, mise à jour automatique et releases livrés). Les bugs confirmés de l'audit du 2026-09-07 sont
> livrés (T3, T4, T10, T14, #23-#29 ; cf. git log). En tête : les constats de la revue du 2026-10-09
> (identifiants C/M de la revue), tous revérifiés sur `main` au 2026-10-15.

---

## Reste à faire

### 🔴 Revue 2026-10 — calcul de la fiche
- [ ] 🟡 **M5 — Niveaux de compétence des fusionnés** — le jeu les reconstruit depuis `CharacterFusionLevel`, l'outil
      prend `First..Ultimate` de la capture (jusqu'à +1 200 CP d'écart). **Bloqué** : il faut une capture d'un
      fusionné dont les compétences d'origine dépassent celles de la fusion.

### 🔴 Contrat solver (avec outerpedia)
> Ordre pour tout changement de forme : outerpedia ajoute sans retirer et pose `schema` ; une version de gear-solver
> qui lit le nouveau champ est publiée ; ensuite seulement on retire l'ancien.

### 🟢 Ratings offensifs — après la colonne « meilleur skill » (2026-09-05)
- [ ] ⚪ **DoT dans le meilleur hit** — assumé non modélisé (Gnosis Beth sous-estimée) ; ne traiter que si le moteur
      damage expose un facteur DoT par skill comparable au hit direct.

### 🟠 Perf solver
- [~] **Solver CP** — perf résolue (> 100 s → < 4 s sur un vrai compte : auto-prune CP-pondéré + budget de combos,
      gemmes notées par apport CP, pin du build courant ; cf. changelog). **Reste** : (a) confirmer en jeu la justesse
      du top-CP (≥ build équipé) ; (b) *optionnel* : la notation standalone peut sous-classer un membre de set couplé
      (garde set-aware) ; (c) *optionnel* : B&B CP exact.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) · **SharedArrayBuffer** pour le flag `cancelled`
      (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings`.

### 🟡/⚪ UX-cohérence & nits
- [~] 🟡 **`Advices` (tab Builds)** — 4pc dispo en inventaire et basse qualité livrés, `inventoryPieces` + `dmgStat`
      passés dans `AdviceInput`. **Reste** : la règle main off-scaling vs `meta.dmgStat` — décision de Sevih (le
      principe du module exclut ce qui demande de deviner l'intention).

### Persistence
- [~] **Equip / Unequip** — Builder « Equip build » et Worklist livrés ; les déplacements faits en jeu suivis en direct
      (journal `item/equip` du plugin 0.2.0, G37). **Reste** : valider G37 en jeu sur le fixe ; (optionnel) un
      déclencheur côté **Builds** (unequip / assignation par slot).

### Externe — vérifs sur la version installée
- [~] 🟢 **Capture no-root** — livrée par la source Steam (plugin BepInEx, validé en jeu le 2026-09-05). **Reste** :
      (a) vérifier qu'un compte mobile se lie au client Steam (FAQ MAJOR9) avant de le vendre aux joueurs ; (b) tester
      le chemin « BepInEx absent » (download + pose dans le dossier du jeu) sur une install vierge.
- [ ] **Vérif sync repo en prod packagé** — 1er lancement online : seed `data/derived` bundlé → comparaison du hash de
      `version.json` → download des artefacts solver depuis `Sevih/outerpedia` ; images en cache à la demande depuis
      R2. Vérifier `/img/*` ne tape R2 que sur miss · 2e lancement inchangé = instantané · simuler un patch
      (`OUTERPEDIA_REF` autre branche) · offline cold-cache = pas de crash.

## Bugs trouvés par l'audit du 2026-10-29 (G69)

> (b) = prouvé, mais plus large ou à trancher ; (c) = plausible, non prouvé. Les corrections sûres de l'audit sont
> dans le changelog.

- [ ] (c) **Auto-prune avec un inventaire pas encore chargé** — `InventoryScreen.tsx:52` / `:165` : monté avant la fin
      d'`autoImport` (rechargement du renderer avec l'onglet Inventaire actif, `gs.tab` étant durable), `ui = []` vide
      toutes les disponibilités et l'auto-prune vide les puces gardées en session. À vérifier : un rechargement du
      renderer arrive-t-il en usage packagé ? Sinon sans effet (la session repart vide à chaque lancement).
- [ ] (b) **Auto-prune à l'Apply d'un preset qui change de portée** — laissé par G70 : un preset qui change les
      emplacements ou l'onglet (ex. Casque + sub EFF, sans casque EFF) perd encore en silence la valeur absente de la
      nouvelle portée ; le cas « même portée » est couvert (valeur grisée, retirable). Touche l'auto-prune : à trancher.
- [ ] ⚪ `docs/reference.md` donne « 8 tests » pour `transfer.test.ts`, compte périmé depuis G67 / G70.

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
