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
- [ ] 🟢 **Potentiel de reroll (Transistone) — patch du 2026-10-20.** Le jeu permet désormais de monter UNE
      ligne de sous-stat jusqu'au niveau 4 par Transistone, si et seulement si la pièce n'a pas déjà de ligne 4
      (les drops vont de 1/1/1/1 à 4/3/3/3, exceptions natives 4/4/3/3 inchangées). Rien n'est modélisé : la
      projection du Builder (`projectPieceForReforge`) ne couvre que le main et les reforges, la qualité
      (`lib/quality.ts`, plafond 14 = 4+4+3+3) ne compte que les ticks présents. À faire : un « potentiel »
      de +1 à +3 ticks sur la ligne la plus utile d'une pièce sans ligne 4, dans la projection et dans la
      qualité « atteignable ». **Décision** avant de coder : une seule ligne rerollable par pièce et une seule
      fois ? règle pour toutes les étoiles ou seulement 6★ légendaires ?
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
