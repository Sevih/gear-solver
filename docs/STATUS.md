# STATUS — où on en est / comment reprendre

Dernière mise à jour : 2026-06-26. Ce fichier est le point d'entrée pour reprendre le
projet à froid. Les détails sont dans les autres docs (liens en bas).

## But du projet

Optimiseur de gear pour **OUTERPLANE** (façon Fribbels) : capturer le gear + persos de ton
compte, puis calculer les meilleures combinaisons par héros. Web app, données auto-importées.

## Ce qui est FAIT et fonctionne

1. **Capture des données du jeu** (`tools/capture/`) — pipeline « un bouton ».
   - Le jeu parle à `glb-game.outerplane.vagames.co.kr:38001` (compte/inventaire) et
     `glb-login…:38002` via le client Unity **BestHTTP/2** sur ports non-standard (ignore le
     proxy système). **Pas de certificate pinning.**
   - Méthode : cert mitmproxy dans le store système (bind mount), redirection iptables des
     ports 38001/38002 vers des proxies mitmproxy **reverse**, puis déchiffrement.
   - Réponses = `{"msg":"<hex>"}` → hex → **XOR clé répétée `ASLDKGFJASPODIFJSOWEI`** → JSON.
   - `capture.ps1` fait tout et déchiffre en direct vers `tools/capture/out/*.json`.

2. **Données statiques du jeu** (`data/`)
   - `data/game/` : 29 tables Outerplane copiées (copie locale, pas de dépendance externe).
   - `data/build.mjs` → `data/derived/` : tables compactes (`options`, `equipment`, `sets`,
     `characters`, `sub-ticks`, …) que le moteur consomme. Re-générable via `npm run data:build`.
     Écrit aussi `version.json` `{ hash, builtAt }` — `hash` = hash de contenu **stable** des
     dérivés (un rebuild no-op ne le bouge pas), affiché dans Settings → Data.
   - `data/sync.ps1` : re-copie depuis Outerpedia + rebuild (à lancer après un patch du jeu).
   - **Sync au lancement depuis le repo public `Sevih/outerpediaV2`** (`apps/desktop/src/data-sync.ts`,
     dual-mode checkout/repo) : images **et** tables suivent les patchs **sans nouveau build** de l'app.
     Handler `/img/*` partagé (`img-cache.ts`) cascade checkout→cache disque→CDN jsDelivr/raw→302.

3. **Moteur** (`packages/core/`, `@gear-solver/core`)
   - Parse l'inventaire capturé en modèle propre avec **vraies valeurs de stats résolues**.
   - Mappings validés par tests : `ItemID`→équipement (slot/set/rareté/nom),
     `OptionID`→stat, `CharID`→perso. Échelle stats validée vs jeu (% stockés ×10).
   - Tests verts : `npm test`.

4. **Renderer** (`apps/renderer/`, Vite + React, embarqué dans Electron)
   - **Auto-import** : au démarrage, charge `data/derived` + `tools/capture/out` (servis en
     direct par un middleware Vite) et affiche l'inventaire parsé. Fallback fichier manuel.
   - **Onglet Home** (par défaut) : dashboard — snapshot du compte (2×2), répartition qualité
     par tier (couleurs partagées avec l'Inventory), répartition étoiles, Library, et
     **update center inline** (check/apply des updates repo, sans popups natifs). Les chiffres du
     dashboard (tiers qualité, par slot, top sets) sont **cliquables** → ouvrent l'Inventory
     pré-filtré sur ce facet (`InventoryDrill`, consommé une fois).
   - **Onglet Inventory** : table + filtres + détail pièce (mains, subs, ticks, reforge,
     breakthrough, singularity), score par pièce, indicateur de qualité. Tris/filtres/onglet
     **session-scoped** (`useSessionState`/sessionStorage) → stables au switch d'onglet, remis
     au défaut au lancement. **Exclusion globale** d'une pièce du solver : clic-droit sur une tile
     (ou bouton dans le détail) → liste durable `gs.solver.excludedPieces`, sautée par tous les solves.
   - **Onglet Builds** : carte par héros avec stats composées (`composeBuild` mirror
     in-game CalcFinalStat), comparaison vs locks régression (`data/stat-locks.json`). **Advices**
     auto par carte (`lib/buildAdvice.ts`, pur + testé) : missing/sets, caps gaspillés (crc/pen
     >100), slots de gem vides (Talisman/EE), reforges non utilisés + 6★ non ascensionné. Filtres
     roster session-scoped.
   - **Onglet Builder** : optimiseur de gear Fribbels-style. Voir [docs/solver.md](solver.md)
     pour le détail. Worker pool en renderer, partition embarrassingly parallel, gem
     sub-solver, modes SOLVE (par Score pondéré) et SOLVE CP (par Combat Power).
     **Câblé end-to-end** : cancel mid-solve (`MessageChannel` yield), colonne Upg
     (calculée, triable, filtrable), Exclude-equipped multi-select, simulation de reforge,
     allocation de gemmes recommandée, Save/Remove build + Filter presets par héros
     (localStorage) + **mémoire auto des filtres par héros** (session-scoped : snapshot au switch de
     héros, restauré au retour), bouton Optimize → depuis l'onglet Builds. **Reste monté entre onglets**
     (`display:none`) → résultats / filtres / héros conservés + solve qui tourne en fond.
     Deux encadrés d'aide par héros : *Sub tick value* (rentabilité flat vs % d'un tick de sub,
     `lib/subValue.ts`) et *Damage / +1%* (gain de dégâts pour +1% des stats de scaling /
     CHD / DMG inc, calculé à 100% crit, SPD/EFF/CHC en secondaires, no-crit détecté,
     `lib/dmgValue.ts`). Table de résultats : colonnes Set / arme / accessoire, menu
     show/hide colonnes, bouton Filter (re-filtre client-side), filtre Min quality, hauteur
     plafonnée (15 lignes). **Reforge 4 modes** (Off / +10R6 / +10R9 / +15R9 — enhancement +
     nb de reforges ; +10R9 = +10 ascended pour les 3 reforges, sans passif +15) + gems cap-reaching.
     **Gear cards résultat** = fork de la carte détail Inventaire (`ResultGearDetail.tsx`,
     portrait héros rond en haut-droite, substats `LV n (Base+Actuelle+Extrapolé)`, étoiles
     violettes à +9 reforges) + **carte « Effects »** sous le panneau stats (passif arme/acc +
     sets actifs, desc au survol via `HoverCard`).
     **Pré-filtrage du pool armor par set** : un set qui contraint tout l'armor (2pc+2pc / 4pc)
     élague les pièces hors-set avant le cartésien ; toggle Options « Allow broken sets » (off →
     chaque pièce armor doit compléter un set, leaf reject des singletons).
   - **Onglet Worklist** : file inter-héros de changements de gear. Le Builder (« + Worklist »)
     y pousse le diff par slot du build sélectionné ; chaque changement = ligne cochable +
     **Apply locally** (`equipPieces` réécrit le snapshot, jamais le jeu). États applied / stale /
     conflict dérivés live de l'inventaire ; **auto-prune à chaque recapture** (`reconcileWorklist` retire
     les changements faits + entrées vidées) (`screens/WorklistScreen.tsx`, `lib/storage/worklist.ts`).
   - **Onglet Settings** : modal left-rail à onglets (Setup · Solver · Data · Backup · Debug). **Setup =
     wizard d'onboarding guidé** (auto-ouvert au 1er lancement) : stepper linéaire qui focalise le blocage
     courant (emulator install/running · ADB · root), instructions **par marque** (LDPlayer/MuMu/Nox),
     **détection générique** de tout émulateur listé par le serveur ADB partagé + **override « Manual
     device »** (adb path + device) pour forcer n'importe quel émulateur rooté hors-profil ;
     étape finale = vraies next-steps de capture. Section Solver (worker count Auto/Manual, result/per-worker
     count, heatmap), backup JSON import/export, sync « game data » manuelle, **version des données dérivées**
     affichée (hash + date, lue depuis `data/derived/version.json`).
   - **Édition d'équipement (méthodes)** : `equipItem`/`unequipItem` (`packages/core/src/equip.ts`,
     réécrivent le `CharUID` du JSON capturé, déplacement de slot, immuables, +tests) + endpoint
     writer `POST /api/captured/user-item` (`server.ts` + miroir Vite) + client `src/equip.ts`.
     **Pas encore d'UI déclencheur** (Builder/Builds) — c'est l'étape restante.
   - **Perf solver** : pool dimensionné à la machine (`hardwareConcurrency − 1`), `game` +
     inventaire envoyés aux workers **une fois** (init), compteur « ⚙ N workers » dans le footer.

5. **Desktop Electron** (`apps/desktop/`) — `main.ts` + serveur local (`server.ts`) +
   détection d'émulateur, capture native via IPC. App fonctionnelle en dev ; le
   **packaging** prod (electron-builder `extraResources`, `setupAutoUpdate`) est **câblé mais
   non vérifié end-to-end** sur un vrai build packagé (cf. todo M7+).

## Comment lancer

```powershell
# 1. (Re)capturer ton compte — LDPlayer lancé, ADB on, Root toggle on
cd tools/capture ; powershell -ExecutionPolicy Bypass -File .\capture.ps1
cd ../..

# 2. Lancer l'app (auto-importe la dernière capture)
npm install        # première fois
npm run dev        # http://localhost:5173

# Autres
npm test                 # tests du moteur
npm run data:build       # régénère data/derived depuis data/game
```

## À RETENIR (gotchas)

- **Root LDPlayer** : doit rester activé pour la capture (cert système + iptables). Le jeu se
  lance très bien avec. Le bind mount + iptables ne survivent pas à un reboot de l'instance →
  `capture.ps1` les ré-applique automatiquement.
- **Clé XOR** : `ASLDKGFJASPODIFJSOWEI` (même pour tous les endpoints).
- **Données perso** (`tools/capture/out/`, `dumps/`) : **gitignore**, jamais commitées.
- **`data/derived` est généré** : ne pas l'éditer à la main, modifier `data/build.mjs`.
- **Commentaires TS** : éviter `*/` littéral dans un bloc `/** */` (ça ferme le commentaire).

## Ce qui RESTE (voir docs/roadmap.md + docs/todo.md pour le détail)

> Le polish solver, la persistance (Save build / Filter presets) et le wrapper Electron
> de base sont **livrés** (voir « Ce qui est FAIT »). Reste :

- **Perf hot-path solver** : l'accumulateur de buckets incrémental, le hoist des set bonuses,
  la virtualisation de la table et les optims SOLVE CP (évaluateur CP préparé + ratings différés)
  sont **livrés**. Reste **structurel** : réduire le **nombre** de combos atteignant le compose/CP
  (pré-filtre de pool plus agressif, borne CP par upper-bound) — demande un profilage sur vrai compte.
- **Packaging desktop (M8)** : le plumbing existe (electron-builder `extraResources`,
  `setupAutoUpdate`) ; reste à **vérifier sur un vrai build packagé** (bake `data/`,
  installeur, auto-update contre une release signée + feed). **Inclut la vérif de la sync
  repo en prod** : 1er lancement online seed→SHA→download→rebuild, cache image à la demande,
  2e lancement SHA inchangé instantané, offline cold-cache sans crash.
- **Édition d'équipement — UI déclencheur** : les méthodes core (`equipItem`/`unequipItem`),
  l'endpoint writer `POST /api/captured/user-item` et le client renderer sont **livrés** ; reste
  à brancher des boutons / assignation par slot côté Builder/Builds (édite le JSON capturé local,
  on n'écrit jamais vers le jeu — API inexistante).
- **Invalidation de cache au patch** : le stamp `version.json` (`{ hash, builtAt }`) est **livré**
  (affiché Settings → Data) ; reste à **comparer le hash** au lancement pour élaguer les caches
  localStorage (SavedBuild aux `pieceUids` disparus).
- **Robustesse/sécu desktop** : cleanup process orphelins, gardes Host/Origin (cf. todo).

## Carte du repo

```
apps/renderer/    UI React + Vite (renderer process Electron) ; le SOLVER vit ici
                  (src/lib/solver/: engine.ts, orchestrator.ts, gems.ts, cp.ts,
                  ratings.ts, setPlans.ts, worker ; composeBuild.ts une couche au-dessus)
apps/desktop/     Electron : main.ts, server.ts (serveur local), emulator-detect.ts
packages/core/    moteur stats : raw.ts, types.ts, gamedata.ts, stats.ts, parse.ts,
                  compose-stats.ts, equip.ts (édition locale), index.ts
tools/capture/    pipeline de capture (capture.ps1, disarm.ps1, addon.py, scripts/)
data/game/        tables brutes du jeu (copie)
data/derived/     tables distillées (générées, kebab-case) — consommées par le moteur
data/build.mjs    distillation ; data/sync.ps1 resync depuis Outerpedia
docs/             architecture.md, data-schema.md, reference.md, roadmap.md, solver.md,
                  todo.md, STATUS.md (ce fichier)
```

## Docs liées

- [README.md](../README.md) — vue d'ensemble + commandes
- [docs/roadmap.md](roadmap.md) — plan détaillé + garde-fous
- [docs/architecture.md](architecture.md) — découpage des couches
- [docs/data-schema.md](data-schema.md) — schéma des données capturées + mappings
- [docs/reference.md](reference.md) — **doc dense unifiée** : traitements (capture→parse→compose→solve), calculs (CalcFinalStat, CP, ratings, score, gems, reforge), sources (tables jeu, locks, RVAs, conventions stat)
- [docs/solver.md](solver.md) — solver Builder : pipeline, panneaux UI, optimisations, limites
- [docs/todo.md](todo.md) — backlog **actionnable** (tâches ouvertes uniquement)
- [docs/changelog.md](changelog.md) — **journal des livraisons** (ce qui est livré, par session)
- [tools/capture/README.md](../tools/capture/README.md) — pipeline de capture en détail
