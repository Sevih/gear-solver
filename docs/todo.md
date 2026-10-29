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

- [ ] 🔴 (b) **Drill de Home élagué par l'onglet quitté** — `apps/renderer/src/screens/inventory/InventoryScreen.tsx:75`
      (effet du drill) et `:165` (auto-prune). Au montage, les deux effets tournent dans le même commit : le drill pose
      `quality = {excellent}` et l'onglet « all », puis l'updater de l'auto-prune reçoit ce nouvel état avec des
      disponibilités calculées sur l'ANCIEN onglet et l'ancien filtre d'emplacement (sessionStorage). Rejeu `npx tsx`
      (`filters.ts` réel, pièces factices) : Inventaire laissé sur Special, clic « Excellent » sur Home → `quality`
      élaguée à vide, la grille All montre toutes les pièces, talismans et EE compris. Même mécanisme pour un drill de
      set d'armure, ou d'un palier absent de l'onglet / de la puce d'emplacement laissés. Pour l'utilisateur : le nombre
      cliqué ne correspond pas à la liste ouverte, sans indice. Recommandation : sauter l'auto-prune tant qu'un drill
      est en attente (`if (drill) return;`, `drill` dans ses dépendances : il repasse au rendu suivant avec la bonne
      portée) — touche l'auto-prune listé « à ne pas toucher » ci-dessous, d'où la décision.
- [ ] 🟡 (b) **Preset de filtres appliqué hors de la portée affichée** — `FilterModal.tsx:206` (`load`). Un preset
      porte ses emplacements et ses Main / Sub / Set / Class ; appliqué sur un autre onglet ou une autre portée, ce que
      la vue n'a pas n'est ni rendu (la `SlotBar` ne montre que les emplacements de l'onglet alors que
      `InventoryTabs.tsx:54` promet qu'une puce périmée ne survit pas ; la modale ne liste que les valeurs disponibles,
      `FilterModal.tsx:479`, `:546`, `:556`, `:576`) ni élagué (l'auto-prune ne tourne qu'au changement de portée, pas
      à l'Apply). Rejeu `npx tsx` : preset `slots = {talisman}` enregistré sur Special, appliqué sur Gear → grille vide,
      pastille du bouton Filter à 0 (les emplacements n'y comptent pas), aucune puce visible ; preset `subs = {eff}`
      sans pièce EFF dans la vue → grille vide, pastille 1, pilule absente de la modale. Seuls « Clear Filter » ou un
      changement d'onglet en sortent. Recommandation : à l'Apply, passer le filtre par la règle de `setTab`
      (emplacements hors onglet retirés) et par l'auto-prune — à trancher, le critère du preset serait perdu en
      silence ; l'autre voie : basculer sur l'onglet All au Load d'un preset qui porte un emplacement hors onglet.
- [ ] ⚪ (b) **Load d'un preset efface la recherche en cours** — `FilterModal.tsx:206` charge `preset.filters` entier,
      dont la `query` vidée à l'enregistrement (`lib/storage/inventoryFilterPresets.ts:114`) : la recherche du
      brouillon disparaît, alors que G67 dit qu'un preset porte tout « sauf la recherche ». Rejeu : lecture
      (`onLoad(userPreset.filters)`, `query: ""`). Recommandation : `onLoad({ ...filters, query: draft.query })` si
      « sauf la recherche » veut dire « la laisse en place ».
- [ ] ⚪ (b) **Import de sauvegarde : compte des entrées que le chargeur jette** — `lib/storage/transfer.ts:127`
      (presets du Builder) et `:111` (presets de l'Inventaire) comptent toute entrée à `id` chaîne ; `loadFilterPresets`
      saute une entrée illisible (G69), `loadInventoryFilterPresets` un nom invalide. Rejeu `npx tsx` : un preset
      `{ id, name }` sans `filters` importé → message « 1 preset », rien de chargé. Pour l'utilisateur : un compte trop
      haut, sur une sauvegarde abîmée seulement. Recommandation : appliquer à l'import les gardes des chargeurs.
- [ ] (c) **Clé des presets du jeu = `num` seul, quel que soit `PresetType`** — `packages/core/src/parse.ts:361` ; rangs
      et verrous (`gs.presets.rank`, `gs.presets.locked`), `lib/presets/presetHolds.ts:39`, `gs.presetHeroes` se clés
      sur `num`. Si le jeu réutilise un `Num` entre presets classiques et Master League, deux presets partagent rang,
      verrou et héros. À vérifier sur une capture avec des presets Master League ; s'ils se recoupent, clé
      `PresetType:Num` (avec migration des clés stockées).
- [ ] (c) **Auto-prune avec un inventaire pas encore chargé** — `InventoryScreen.tsx:52` / `:165` : monté avant la fin
      d'`autoImport` (rechargement du renderer avec l'onglet Inventaire actif, `gs.tab` étant durable), `ui = []` vide
      toutes les disponibilités et l'auto-prune vide les puces gardées en session. À vérifier : un rechargement du
      renderer arrive-t-il en usage packagé ? Sinon sans effet (la session repart vide à chaque lancement).

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
