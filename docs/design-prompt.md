# Design brief — gear-solver (Outerplane gear optimizer)

> Brief à passer à Claude Design. Décrit le projet, l'identité visuelle, les
> 3 écrans à designer, les composants attendus, et le format de livrable.
> Premier passage : on cible des mockups annotés (layouts + composants), pas
> du code. Itération ensuite.

## Contexte

**gear-solver** est une app Electron desktop locale qui :

1. Capture le gear et les héros depuis le client Outerplane (jeu mobile gacha).
2. Affiche l'inventaire complet (gear + persos) avec stats résolues.
3. Résout des builds optimaux par héros via un solveur à contraintes
   (pondérations stats, sets requis, min/max).

Utilisateur cible : un joueur Outerplane qui veut optimiser le placement de
ses pièces de gear sur ses héros (style Fribbels pour les connaisseurs Epic7).

Le repo principal **outerpedia-v2** (https://outerpedia.com) contient déjà
toute la base de composants (cards d'équipement, portraits de personnages,
filtres, etc.) qu'on va **porter 1:1** dans gear-solver. La prompt doit
réutiliser leur langage visuel.

## Stack & contraintes techniques

- **React 18 + Vite + Tailwind v4** (à installer dans gear-solver).
- Composants à porter depuis outerpedia-v2 (chemins relatifs au repo
  outerpedia-v2/src/app/components) :
  - `equipment/EquipmentIcon.tsx` — icône d'item avec overlays (stars,
    classe, effet, breakthrough T1..T4, enhance +N, rarity bg, Singularity
    gradient cyan→magenta).
  - `equipment/{WeaponMiniCard,AmuletMiniCard,TalismanMiniCard,SetMiniCard,EECard}.tsx`
    — cards compactes pour chaque type d'item.
  - `equipment/SubstatPrioBar.tsx` — barre de priorité de substats.
  - `character/CharacterPortrait.tsx` — portrait avec overlays classe/élément.
  - `character/CharacterCard.tsx` / `ResponsiveCharacterCard.tsx` — card complète.
  - `characters/filters/*` — système de filtres (sidebar, drawer, bar, atomes).
  - `inline/*Inline.tsx` — tooltips inline (items, persos, effets, stats).
  - `ui/{FilterPills,FiltersTopBar,FitText,StarIcons}.tsx` — primitives.
- Tout le rendu doit **rester desktop + mobile-friendly** (Tailwind responsive).

## Identité visuelle (à reprendre tel quel d'outerpedia-v2)

- **Theme dark** par défaut : fond `#0e0e10` à `#16161a`, panneaux
  `bg-zinc-900/60` avec borders `border-zinc-800` / `border-white/10`,
  texte `text-zinc-300` / `text-zinc-100`.
- **Font** : `--font-game` (titres, headers, stats) + `--font-geist-mono`
  (valeurs numériques tabulaires) + sans-serif système pour le texte courant.
- **Palette tokens** :
  - Éléments : Fire `#ff6b6b`, Water `#4dabf7`, Earth `#51cf66`,
    Light `#ffe066`, Dark `#cc5de8`.
  - Rarity item : normal `#e5e7eb`, superior/magic `#4ade80`,
    epic/rare `#93c5fd`, legendary/unique `#f87171`.
  - Stats : `#fbbf24` (or). Highlight : `#22d3ee` (cyan).
  - Buff `#38bdf8`. Debuff `#f87171`.
  - **Singularity gradient** (ascended items, vertical) :
    `linear-gradient(180deg, #16EBF1 0%, #9D51FF 50%, #E02BCD 100%)`.
  - Stars : doré `#facc15` pour normal, gradient Singularity pour ascended.
- **Corner radius** : `rounded-lg` (8px) pour les cards, `rounded-md` (6px)
  pour les boutons/inputs.
- **Espacement** : ≥ `gap-3` (12px) entre éléments, `p-4` (16px) padding
  intérieur de cards.

## Navigation globale

3 onglets en haut de page (sticky header), même langage visuel que la nav
d'outerpedia-v2 :

1. **Inventory** — vue brute en tableau de toutes les pièces capturées.
2. **Builds** — liste des héros possédés, chacun avec son gear actuellement
   équipé en preview.
3. **Builder** — le solveur : choisir un héros, fixer des contraintes,
   lancer la recherche, comparer les top-N.

À gauche du header : logo "gear-solver" + version. À droite : bouton
**Capture** (avec status pill `● armé` / `○ inactif`), bouton **Désarmer**,
bouton **Recharger inventaire**.

## Écran 1 — Inventory (read-only browser)

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header (3 tabs · capture controls)                          │
├─────────────────────────────────────────────────────────────┤
│ Filters (sidebar gauche, w-64) │ Tableau (flex-1)           │
│                                │                            │
│ Slot   [pills: weap helm…]     │ ★  Sort dropdown · Limit   │
│ Rarity [pills: u r m n]        │                            │
│ Stars  [chips 1-6]             │ [Item icon] [Name…] [stats]│
│ Stat   [select multi]          │ [Item icon] [Name…] [stats]│
│ Lv     [range slider 0-15]     │ …                          │
│ Brk    [chips T0-T4]           │                            │
│ Status [☑ équipé ☑ libre       │ Footer : N items affichés  │
│         ☑ locked]              │  · "Voir 200 de plus"      │
│ Sing   [☐ only]                │                            │
│ Search [text]                  │                            │
└─────────────────────────────────────────────────────────────┘
```

### Données par ligne (1 pièce)

- **Icône** (`EquipmentIcon` 50×50) : item icon + rarity bg + stars row +
  effect icon top-right + class icon (slot d'en dessous) + T<N>
  middle-left + +N middle-right (Singularity gradient si ascended) +
  bottom-row stars (jaune normal / Singularity ascended).
- **Nom** + chip `[Slot]` + chip `[Rarity]` + chip `[★N]` + chip d'état
  (`● équipée` vert / `🔒 locked` / `✦ Singularity` violet).
- **Main stat** : ligne compacte "ATK 1380 / ATK% 69%" en `font-mono`.
- **Substats** : 4 chips mono, code couleur léger par stat
  (`text-amber-300/90` pour offensives, `text-cyan-300/80` pour utility),
  affichage `LV<n>` discret après chaque sub.
- **Reforge count** (`R N/maxReforge`) en `text-xs text-zinc-500`.
- **Équipée sur** : si `equippedBy`, mini-portrait 24px du perso + nom
  (hover tooltip via `CharacterInline`).

### Interactions

- **Click sur la ligne** : ouvre un **drawer/sheet** à droite (overlay)
  avec la vue détaillée — `WeaponCard` / `AmuletCard` / `TalismanCard` /
  `EECard` selon le slot, en taille pleine (le composant
  `equipment/<X>Card.tsx` existe déjà côté outerpedia-v2).
- **Filtre** : chaque filtre applique en live (pas de bouton "Apply").
- **Tri** : header `★` / `Lv` / `Brk` cliquable, indicateur ▲/▼.
- **État vide** : aucune capture → CTA "Lancer la capture" qui déclenche
  `/api/capture/run`.

## Écran 2 — Builds (per-character roster)

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header                                                       │
├─────────────────────────────────────────────────────────────┤
│ Filter bar (top, slim) : élément · classe · search · stars  │
├─────────────────────────────────────────────────────────────┤
│ Grid responsive de character cards (3 cols desktop,         │
│   2 cols tablet, 1 col mobile)                              │
│                                                              │
│  ┌────────────────────┐  ┌────────────────────┐             │
│  │ [Portrait 64px]    │  │ …                  │             │
│  │ Nom · ★N · 🔥 Fire │  │                    │             │
│  │ Class : Striker    │  │                    │             │
│  │ ───────────────    │  │                    │             │
│  │ Gear équipé :      │  │                    │             │
│  │ [wpn] [hlm] [arm]  │  │                    │             │
│  │ [glv] [bts] [acc]  │  │                    │             │
│  │ [tal] [ee]         │  │                    │             │
│  │                    │  │                    │             │
│  │ → "Optimiser"      │  │                    │             │
│  └────────────────────┘  └────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Données par card (1 perso)

- `CharacterPortrait` size="lg" (96px) avec overlays classe + élément.
- Nom + ★ count (Trance star) + classe + élément en sous-titre.
- Grille 4×2 (ou 8×1 selon largeur) des **8 slots** : weapon, helmet,
  armor, gloves, boots, accessory, talisman, exclusive. Chaque slot
  montre un mini `EquipmentIcon` 32×32 si équipé, sinon une silhouette
  grise.
- Hover sur un slot → tooltip avec la pièce (nom + main + substats
  abrégés).
- Bouton **"Optimiser"** (primary, accent cyan) → navigue vers Builder
  avec ce héros pré-sélectionné.
- Indicateur **"completion"** : N/8 slots remplis (badge dans le coin
  haut-droit).

### Interactions

- Filtre top bar : par élément (pills élément), classe (pills classe),
  search par nom, toggle "Avec gear équipé seulement".
- Tri : par classe / par élément / par nombre de slots remplis / par
  étoiles desc.

## Écran 3 — Builder (le solveur)

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Header                                                           │
├──────────────────────┬─────────────────────────────────────────┤
│ LEFT (w-80) :        │ RIGHT (flex-1) : résultats              │
│                      │                                          │
│ Picker héros         │ ┌─────────────────────────────────────┐  │
│ [portrait + name +   │ │ Solve summary :                     │  │
│  swap button]        │ │  N builds, evaluated=Mk, pruned=Nk │  │
│                      │ │  duration=Xs                        │  │
│ ─────                │ └─────────────────────────────────────┘  │
│ Goal :               │                                          │
│ [Weights] tab        │ Top 20 builds (paginated/scrollable)    │
│ - ATK    [slider]    │                                          │
│ - HP     [slider]    │ ┌─────────────────────────────────────┐  │
│ - SPD    [slider]    │ │ #1 score 8742                       │  │
│ - CRC    [slider]    │ │ [wpn][hlm][arm][glv][bts][acc][tal] │  │
│ - CRD    [slider]    │ │ Totals : ATK 12k · CRD 320% · ATK%  │  │
│ - EFF    [slider]    │ │  88% · SPD 168 · …                  │  │
│ - …                  │ │ Set : 2pc Spd ·  2pc Crit · 2pc ATK │  │
│ [Reset · Preset…]    │ │ Diff vs current : +ATK 4k, +SPD 38  │  │
│                      │ │ [Apply] [Detail]                    │  │
│ ─────                │ └─────────────────────────────────────┘  │
│ Constraints :        │ ┌─────────────────────────────────────┐  │
│ - SPD min/max        │ │ #2 …                                │  │
│ - CRC min            │ └─────────────────────────────────────┘  │
│ - EFF min            │                                          │
│ - Required sets      │                                          │
│   [+ Add set]        │                                          │
│ - Locked pieces      │                                          │
│   [+ Pick]           │                                          │
│                      │                                          │
│ [SOLVE button]       │                                          │
└──────────────────────┴─────────────────────────────────────────┘
```

### Sub-composants importants

- **Picker héros** : ouvre un modal de sélection (réutiliser
  `CharacterPicker` d'outerpedia-v2, déjà avec recherche + filtres).
- **Slider de poids** : 0..10, valeur typée affichée à droite, reset par
  stat.
- **Required sets** : pills sélectionnables (réutilise `SetMiniCard`),
  contraintes par paire (2pc / 4pc).
- **Locked pieces** : drag from inventory OR picker dédié.
- **Bouton SOLVE** : large, primary cyan. Pendant exécution :
  spinner + "Évalué X / Élagué Y" en live.
- **Build card résultat** : grid 8 slots (mini icons), totaux compacts
  en `font-mono`, score en grand, diff vs current en chips colorés
  (vert / rouge), 2 actions (Apply = simule l'équipement, Detail = ouvre
  drawer avec calculs détaillés).

### États

- **Idle / no hero picked** : illustration vide + CTA "Pick a hero".
- **Solving** : progress bar + counts évalués/élagués en live.
- **No results** : "Aucun build ne satisfait les contraintes" + suggérer
  de relâcher.
- **Results loaded** : top-N grid, sort dropdown (par score / par stat
  spécifique).

## Composants à designer (catalogue)

| Composant | Variante(s) | Notes |
|---|---|---|
| `GearRow` | inventory list | Icône + nom + chips + mains + subs |
| `GearDrawer` | side panel | Vue détaillée d'une pièce |
| `CharacterCard` | builds grid | Portrait + 8 slots équipés + bouton |
| `SlotMini` | small icon | 32px, vide ou rempli, hover tooltip |
| `WeightSlider` | builder left | Stat name + slider + value mono |
| `BuildResultCard` | builder right | Score + 8 slots + totaux + diff + actions |
| `FilterPanel` | inventory | Sidebar avec slot/rarity/star/stat/lv/brk |
| `CaptureControls` | header right | Run / Disarm / Reload + status pill |

## Deliverables attendus

Pour ce 1er passage Claude Design :

1. **Wireframes annotés** (1 par écran, 1080×768 desktop + 375×667 mobile).
2. **Composants détaillés** : 1 mockup par composant du catalogue ci-dessus
   avec ses states (default / hover / active / loading / error / empty).
3. **Tokens utilisés** explicitement (couleurs, espacements, font sizes)
   par référence aux tokens outerpedia-v2 listés plus haut.
4. **Pas de code** à ce stade — mockups visuels + annotations textuelles
   suffisent. La phase d'implémentation viendra après itération.

## Hors scope (à ignorer pour ce 1er passage)

- Onboarding / tour produit.
- Login / partage social.
- Comparaison side-by-side de 2 builds (envisagé pour la v2).
- Export (CSV / image).
- Persistance des builds (IndexedDB) — c'est M7 dans la roadmap.
