# À faire : mod usage-limits

## Où on en est (29 oct. 2026)

La bande s'affiche dans VS Code. Le responsive est en place, d'après la valeur « N col » (largeur de la bande) :

| Colonnes | Mode |
|---|---|
| 100 et plus | large : icône + verdict en texte, deux barres de 120 px |
| 70 à 99 | moyen : barres de 84 px |
| 33 à 69 | étroit : icône seule (verdict au survol), les deux barres sur une ligne, collées à droite, largeur calculée d'après la fenêtre. De 50 à 69 : au plus 65 % de la largeur dispo |
| 32 et moins | très étroit : pas d'icône, les deux barres l'une sur l'autre |

- Sous la carte : « Reset : session … · semaine … », puis une ligne provisoire « N col · mode ». La phrase de conseil est retirée (le tableau ADVICE reste dans le code).
- Survol : l'icône affiche le verdict, chaque barre affiche le détail (consommé, temps écoulé, reset).
- La largeur n'est plus écrite dans l'atome `width` pendant le tracé (c'était probablement ce qui empêchait le mod de s'afficher en 0.10.0). `/limites` n'affiche donc plus la largeur.
- Barres : conversion colonnes vers pixels estimée à environ 9 px par colonne, calibrée sur des captures à 66 et 69 colonnes.

## 0.12.0 (30 oct. 2026)

- Réglages `barHeight` (épaisseur des barres SVG, en px) et `bandPadding` (marge verticale de la carte, en lignes).
- Ligne des tokens sous la bande (`showTokens`) : dernier tour, total de la session, contexte. Détail du cache dans `/limites`.
- Fenêtre par modèle (`seven_day_fable`...) : affichée seulement si ce modèle est sélectionné, à la place de la fenêtre générale. Le compte Pro ne remonte pas de fenêtre Fable au 30 oct. : jamais vu en vrai.
- Tests : `claude plugin test .` (hooks/register.test.tsx).

## Reste à faire

0. Vérifier en vrai dans VS Code : épaisseur des barres, hauteur de la bande, ligne des tokens (longueur en mode étroit).

1. Régler les seuils 100 et 70 : demander la valeur « N col » en fenêtre large, et à partir de quelle largeur le rendu devient mauvais. Cas connu : à 70 colonnes (mode moyen) les barres de 84 px sont plus petites qu'à 69 (mode étroit).
2. Vérifier le mode très étroit (32 colonnes et moins) : jamais vu sur capture.
3. Enlever la ligne « N col · mode » quand les seuils sont réglés.
4. Le bug des barres qui disparaissent quand l'utilisateur « change de mode » : image SVG non chargée (le texte alternatif s'affichait). Passées en SVG interactif, à confirmer.
5. README : remplacer `<compte>/<depot>` quand le dépôt GitHub existe, et ajouter une section « Installation sans GitHub » (zip + `claude --plugin-dir` ou `CLAUDE_CODE_PLUGIN_DIRS`).

## Règles

- Après chaque changement : `/reload-plugins` suffit, puis un message à Claude (la bande n'apparaît qu'après sa première réponse).
- Refaire le zip : `cd /home/matis && rm -f /mnt/c/Users/matis/Downloads/usage-limits.zip && zip -r -q /mnt/c/Users/matis/Downloads/usage-limits.zip claude-usage-limits`
- Ne jamais lancer git : donner les commandes à copier-coller. Pas de trailer Co-Authored-By.
- Le mode auto peut refuser d'écrire dans le dossier du mod : écrire dans le scratchpad puis `cp`.
- Pas de contrôle de types possible avec `claude` : installer typescript hors du dossier du mod.
