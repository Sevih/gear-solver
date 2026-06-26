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
- [~] **Solver CP trop lent** — coût par combo réduit (évaluateur CP préparé + cheap ratings différés) ET
      **nombre de combos** réduit : pruning par dominance en mode CP (pré-filtre de pool, cf. changelog).
      **Reste (optionnel)** : branch-and-bound CP exact (borne sup par sous-arbre vs K-ième meilleur) — gain
      potentiellement modeste vu `topK = 1000`/worker, à n'envisager que si un profilage sur vrai compte le réclame.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) · **SharedArrayBuffer** pour le flag
      `cancelled` (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings`.

### 🟡/⚪ UX-cohérence & nits
- [~] 🟡 **`Advices` (tab Builds)** — lot prioritaire livré (`lib/buildAdvice.ts` : caps gaspillés, gems
      vides, upgrade agrégé ; cf. changelog). **Reste** : (1) bruit Missing sur persos peu équipés ·
      (2) pièces non max-enhance (cap +N ambigu, à valider) · (3) lot secondaire (main off-scaling vs
      `meta.dmgStat`, basse qualité, « 4pc dispo en inventaire ») — nécessite de passer l'inventaire complet
      à `computeAdvice`.
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
- [~] **Equip / Unequip** — méthodes core (`equipItem`/`unequipItem`) + endpoint writer
      `POST /api/captured/user-item` + client renderer (`src/equip.ts`) livrés (cf. changelog). **Reste
      (étape 3)** : **déclencheur UI** côté Builder/Builds (boutons / assignation par slot) → appelle le client
      puis `refreshInventory` (`App.tsx`). Vérif round-trip live à faire quand l'UI est branchée.

### Externe — Packaging desktop (vérif sur un vrai build, le plumbing existe)
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
