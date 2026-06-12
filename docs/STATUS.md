# STATUS — où on en est / comment reprendre

Dernière mise à jour : 2026-06-12. Ce fichier est le point d'entrée pour reprendre le
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
   - `data/game/` : 18 tables Outerplane copiées (copie locale, pas de dépendance externe).
   - `data/build.mjs` → `data/derived/` : tables compactes (`options`, `equipment`, `sets`,
     `characters`) que le moteur consomme. Re-générable via `npm run data:build`.
   - `data/sync.ps1` : re-copie depuis Outerpedia + rebuild (à lancer après un patch du jeu).

3. **Moteur** (`packages/core/`, `@gear-solver/core`)
   - Parse l'inventaire capturé en modèle propre avec **vraies valeurs de stats résolues**.
   - Mappings validés par tests : `ItemID`→équipement (slot/set/rareté/nom),
     `OptionID`→stat, `CharID`→perso. Échelle stats validée vs jeu (% stockés ×10).
   - Tests verts : `npm test`.

4. **App web** (`apps/web/`, Vite + React)
   - **Auto-import** : au démarrage, charge `data/derived` + `tools/capture/out` (servis en
     direct par un middleware Vite) et affiche l'inventaire parsé. Fallback fichier manuel.

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

## Ce qui RESTE (voir docs/roadmap.md pour le détail)

- **M3** Inventaire UX : tri/filtre, détail pièce, score par pièce.
- **M4** Modèle de stats complet : scaling du **main stat** (enhancement +0→+15, breakthrough
  +5%/palier, singularity), **bonus de set**, **stats de base persos** → totaux réels.
- **M5** Solveur : recherche combinatoire élaguée dans un Web Worker (`solver.ts` est un stub).
- **M6** Solveur UX : panneau par héros (poids, contraintes min/max, sets requis), résultats.
- **M7** Persistance locale, build prod des données, option desktop Tauri.
- **UI design** : reporté (à faire quand on attaque M3/M6).

## Carte du repo

```
apps/web/         UI React + Vite (auto-import + aperçu inventaire)
packages/core/    moteur : raw.ts, types.ts, gamedata.ts, stats.ts, parse.ts, score.ts, solver.ts
tools/capture/    pipeline de capture (capture.ps1, disarm.ps1, addon.py, scripts/)
data/game/        tables brutes du jeu (copie)
data/derived/     tables distillées (générées) — consommées par le moteur
data/build.mjs    distillation ; data/sync.ps1 resync depuis Outerpedia
docs/             architecture.md, data-schema.md, roadmap.md, STATUS.md (ce fichier)
```

## Docs liées

- [README.md](../README.md) — vue d'ensemble + commandes
- [docs/roadmap.md](roadmap.md) — plan détaillé + garde-fous
- [docs/architecture.md](architecture.md) — découpage des couches
- [docs/data-schema.md](data-schema.md) — schéma des données capturées + mappings
- [tools/capture/README.md](../tools/capture/README.md) — pipeline de capture en détail
