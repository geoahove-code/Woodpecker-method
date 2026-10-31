# Woodpecker Method — entraînement tactique multi-variantes

Application web **100 % côté client** (HTML + Vanilla JS + CSS, aucun backend, aucun compte) pour
travailler la méthode Woodpecker sur les 10 thèmes de l'*Encyclopédie des combinaisons tactiques*.

Le différenciateur : **toutes les meilleures réponses adverses doivent être jouées**. Un puzzle n'est
résolu que lorsque l'arbre de solution complet a été parcouru, pas seulement une ligne.

---

## Démarrage

```bash
npm run serve      # http://localhost:3000
npm test           # tests du moteur, du corpus et des cycles Woodpecker
```

Aucune dépendance npm : tout est déjà dans `lib/` et `assets/`. Le serveur `scripts/serve.mjs` est un
simple serveur statique (obligatoire : les modules ES ne fonctionnent pas en `file://`).

---

## Le moteur multi-variantes

`js/puzzle-engine.js` parcourt un arbre pré-calculé :

```
racine (joueur au trait)     → coups acceptés pour le joueur
  profondeur 1 (adversaire)  → TOUTES les défenses dans une marge de 200 cp (max 3)
    profondeur 2 (joueur)    → coups acceptés
      ...
```

* Un coup incorrect ne déplace pas la pièce, incrémente le compteur d'erreurs et marque le puzzle
  comme raté pour le cycle (même s'il est ensuite terminé).
* Après chaque coup juste, l'adversaire répond automatiquement ; quand une branche est finie, le
  moteur **revient** sur la branche défensive non traitée.
* La progression compte les arêtes *joueur* : `played / total`. Le puzzle est résolu quand toutes
  sont jouées, ce qui implique d'avoir affronté toutes les défenses obligatoires.
* « Voir la solution » parcourt l'arbre automatiquement et compte le puzzle comme raté.

Fonctions clés : `PuzzleEngine.attempt()`, `pump()`, `pendingMoves()`, `progress()`, `treeState()`,
`findPending()`.

## Comment les arbres ont été produits

Les puzzles Lichess ne fournissent qu'une seule ligne. Les arbres de ce dépôt ont été **pré-calculés**
avec Stockfish 16 (voir `scripts/`) :

| Paramètre | Valeur |
|-----------|--------|
| Marge des réponses adverses | **200 centipawns** (marge demandée) |
| Réponses adverses max par nœud | 3 |
| Alternatives acceptées pour le joueur | 25 cp (le coup officiel Lichess est toujours accepté) |
| Profondeur d'analyse | 12 (MultiPV 5) |
| Budget de nœuds par puzzle | 24 |

**Pourquoi pré-calculer plutôt que Stockfish-WASM dans le navigateur ?** Le calcul à la volée coûtait
0,5 à 2 s par nœud (donc plusieurs secondes par puzzle, alors que le plan visait < 1 s) et imposait un
WASM de plusieurs dizaines de Mo. Les arbres sont ici calculés une fois, livrés avec l'app (1,9 Mo) :
résolution instantanée, résultat déterministe et **fonctionnement hors-ligne complet**. Les positions
importées (PGN/FEN) utilisent la ligne fournie comme arbre mono-variante.

Régénérer le corpus :

```bash
# 1. dump Lichess (CC0) puis candidats filtrés
curl -o /tmp/puzzles.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
python3 scripts/extract-candidates.py      # → /tmp/candidates.json
# 2. sélection équilibrée : 10 thèmes × 3 niveaux × 100
node scripts/select-puzzles.mjs             # → /tmp/selected.json
# 3. arbres Stockfish (binaire natif, cf. variable SF)
node scripts/build-trees.mjs               # → /tmp/trees.jsonl (reprise possible)
# 4. fusion + validation
node scripts/finalize-puzzles.mjs          # → data/puzzles.json
```

Corpus livré : **2 915 puzzles**, 57,9 % avec au moins deux défenses obligatoires, moyenne de
3,4 réponses adverses par nœud adverse.

## Les 10 thèmes

| # | Thème ECT | Tags Lichess |
|---|-----------|--------------|
| 1 | Annihilation du défenseur | `deflection`, `trappedPiece`, `capturingDefender`, `hangingPiece` |
| 2 | Blocage | `zugzwang`, `quietMove`, `defensiveMove` |
| 3 | Dégagement | `clearance`, `interference` |
| 4 | Déviation | `deflection`, `decoy` |
| 5 | Attaque découverte | `discoveredAttack`, `doubleCheck`, `xRayAttack` |
| 6 | Clouage | `pin`, `skewer` |
| 7 | Démolition de structure | `sacrifice`, `kingsideAttack`, `exposedKing`, `attackingF2F7` |
| 8 | Appât | `attraction`, `decoy` |
| 9 | Interférence | `interference`, `quietMove` |
| 10 | Double attaque | `fork`, `doubleThreat`, `mateIn1..3` |

## Méthode Woodpecker

`js/woodpecker.js` : un ensemble est un corpus **fixe**, chaque cycle le rejoue en entier.

* chronomètre de cycle continu, conservé entre les puzzles et restaurable (session en localStorage) ;
* les puzzles ratés au cycle précédent passent **en tête** du cycle suivant ;
* à la fin du cycle : temps total, réussite, et **compression** par rapport au cycle précédent
  (objectif : 2× plus rapide), affichée sur le tableau de bord et dans les statistiques.

## Structure

```
index.html          tableau de bord (KPI, progression, thèmes, ensembles)
train.html          échiquier, chronomètres, arbre de variantes, promotion, solution
sets.html           création / duplication / suppression d'ensembles, import PGN-FEN
stats.html          historique des cycles, réussite par thème, courbe, heatmap
css/                design system (main), composants, échiquier
js/                 app (shell + dashboard), train, sets, stats, moteur, woodpecker,
                    puzzle-db, board (Chessground), charts, sound, storage, i18n
lib/                chess.js 1.4.0, Chessground 9.2.1 + thèmes CSS, pièces cburnett
data/puzzles.json   2 915 puzzles avec arbre de solution
assets/fonts/       Inter (woff2, local)
sw.js               précache hors-ligne de toute l'app
scripts/            pipeline de données + serveur statique
tests/              moteur, corpus, cycles Woodpecker
```

## Choix techniques

* **Aucune dépendance runtime** hors `lib/` versionné ; pas d'étape de build.
* **Sons synthétisés** en WebAudio (`js/sound.js`) : aucun fichier audio, marche hors-ligne.
* **Pièces** : jeu cburnett embarqué en base64 dans le CSS de Chessground ; `assets/pieces` n'est pas nécessaire.
* **Stockage** : localStorage pour réglages, ensembles, cycles, résultats et session en cours.
* **Bilingue FR/EN** (`js/i18n.js`, bascule instantanée, persistée).
* **Hors-ligne** : service worker qui précache pages, JS, CSS, polices et corpus.

## Limites connues

* L'analyse des positions importées n'est pas recalculée : la ligne du PGN / FEN est la solution.
* Chessground est distribué en **GPL-3.0** (comme l'app d'origine) ; chess.js en BSD-2,
  Stockfish en GPL-3, Inter en OFL, puzzles Lichess en **CC0**.
