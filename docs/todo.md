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
- [~] 🟡 **Mineurs de fiche (revue)** — reste : `combatOnly` des mains d'EE décidé par le nom et non par le Type
      (latent ; posé par le générateur d'outerpedia, contrat).

### 🔴 Revue 2026-10 — moteur et Builder
- [~] 🟡 **Mineurs moteur / Builder (revue)** — reste : `buildAdvice` propose « +5 pour un 5e emplacement de gemme »
      aux talismans 4★/5★ qui n'en ont pas.

### 🔴 Contrat solver (avec outerpedia)
> Ordre pour tout changement de forme : outerpedia ajoute sans retirer et pose `schema` ; une version de gear-solver
> qui lit le nouveau champ est publiée ; ensuite seulement on retire l'ancien.
- [~] 🟡 **L6 — Une table `ST_*` → clés unique**, émise dans le contrat (`solver/stat-keys.json`) et lue par
      `GAME_STAT` et par le wiki. Y faire entrer les mains d'EE `ST_AVOID` (précision vs élément), présentes dans
      `buffs.json` mais inconnues de `GAME_STAT` → le main disparaît du panneau au lieu d'être affiché combat-only.
      Table du contrat tenue sous test (G30) ; reste le main d'EE `ST_AVOID` affiché combat-only, et la lecture par
      le wiki côté outerpedia.
- [ ] ⚪ **Règles du jeu recopiées à la main** au lieu de venir du contrat : `REFORGE_PER_SUB_CAP`
      (`OptionMaxValue`, que `parse.ts` n'applique pas non plus : sans effet tant que max = 6 × valeur), budgets
      6/9 (`AddSmeltingCount`), emplacements de gemme (`GemSlot`), `EVO_UNLOCK_LEVEL`. `ee-passives` ne garde que
      TargetType ME et le niveau de buff le plus haut (0 écart, fragile).

### 🟢 Ratings offensifs — après la colonne « meilleur skill » (2026-09-05)
- [ ] 🟢 **DPS de rotation pondéré par les cooldowns** — `dmgs` = hit du meilleur skill × SPD, pas une rotation. La
      donnée damage d'outerpedia porte déjà `levels[].cool` / `startCool` par skill : un facteur « moyen par tour »
      (S1 filler + S2/S3 quand dispo) est calculable côté générateur. À faire dans le pipeline (nouveau champ),
      jamais en parsant localement.
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
- [~] **Equip / Unequip** — Builder « Equip build » et Worklist livrés. **Reste (optionnel)** : un déclencheur côté
      **Builds** (unequip / assignation par slot).

### Externe — vérifs sur la version installée
- [~] 🟢 **Capture no-root** — livrée par la source Steam (plugin BepInEx, validé en jeu le 2026-09-05). **Reste** :
      (a) vérifier qu'un compte mobile se lie au client Steam (FAQ MAJOR9) avant de le vendre aux joueurs ; (b) tester
      le chemin « BepInEx absent » (download + pose dans le dossier du jeu) sur une install vierge.
- [ ] **Vérif sync repo en prod packagé** — 1er lancement online : seed `data/derived` bundlé → comparaison du hash de
      `version.json` → download des artefacts solver depuis `Sevih/outerpedia` ; images en cache à la demande depuis
      R2. Vérifier `/img/*` ne tape R2 que sur miss · 2e lancement inchangé = instantané · simuler un patch
      (`OUTERPEDIA_REF` autre branche) · offline cold-cache = pas de crash.

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
