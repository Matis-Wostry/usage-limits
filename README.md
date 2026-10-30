# usage-limits

Un mod pour Claude Code qui affiche ta consommation des limites (session de 5 h et semaine) au-dessus du champ de saisie, avec un verdict de rythme :

- **Pousser** : tu consommes moins vite que le temps ne passe, tu as de la marge.
- **Rythme normal** : tu es dans le rythme.
- **Ralentir** : tu consommes plus vite que le temps ne passe.
- **Limite proche** : une fenêtre approche du seuil d'alerte.

La fenêtre de 5 h décide du verdict ; la fenêtre de 7 jours ne sert qu'à départager. Le trait noir sur chaque barre marque le temps déjà écoulé dans la fenêtre : colorée en deçà du trait, tu as de la marge ; au-delà, tu consommes trop vite.

## Installation

### Avec GitHub (recommandé)

Dans une session Claude Code (terminal) :

```
/plugin install usage-limits --marketplace Matis-Wostry/usage-limits
```

Réponds `y` pour ajouter le marketplace, puis choisis la portée (utilisateur pour l'avoir partout). Dans l'application bureau, où `/plugin` ne fonctionne pas : clique sur **+** à côté du champ de saisie, **Plugins**, **Add marketplace** avec `Matis-Wostry/usage-limits`, puis **Add plugin**.

### Sans le marketplace (dossier local)

1. Récupère le dépôt dans un dossier à toi, par exemple :

   ```
   git clone https://github.com/Matis-Wostry/usage-limits.git D:\mods\usage-limits
   ```

2. Au choix :
   - **Un essai** : lance `claude --plugin-dir "D:\mods\usage-limits"`.
   - **En permanence** : dans ton `settings.json` utilisateur (`~/.claude/settings.json`, ou `%USERPROFILE%\.claude\settings.json` sous Windows), ajoute :

     ```json
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "D:\\mods\\usage-limits"
     }
     ```

3. Ouvre une nouvelle session (ou tape `/reload-plugins` si elle existe chez toi), puis envoie un message à Claude : la bande n'apparaît qu'après sa première réponse.

## Mise à jour

### Installé avec le marketplace

Dans un terminal :

```
claude plugin marketplace update usage-limits
claude plugin update usage-limits@usage-limits
```

La première commande récupère la dernière version sur GitHub, la seconde l'installe. Redémarre ensuite Claude Code pour qu'elle s'applique.

Dans l'application bureau : clique sur **+** à côté du champ de saisie, **Plugins**, rafraîchis le marketplace `usage-limits`, puis mets le plugin à jour.

### Installé depuis un dossier local

Dans le dossier du dépôt :

```
git pull
```

Puis tape `/reload-plugins` (ou ouvre une nouvelle session) et envoie un message à Claude : la bande revient après sa première réponse.

### Vérifier la version

`/usage-limits-config` doit lister les réglages `barHeight`, `bandPadding` et `showTokens` : ils sont arrivés avec la 0.12.0.

## Où ça s'affiche

La bande s'affiche dans **VS Code**. Elle n'apparaît pas dans l'onglet Code de l'application bureau. Si elle manque, tape `/limites` : une réponse avec des chiffres prouve que le mod est chargé.

## Commandes

- `/limites` : détail en texte, et fait revenir la bande si elle est masquée.
- `/limites-masquer` : masque la bande.
- `/usage-limits-config` : liste les réglages du mod ; `/usage-limits-config showPaceMark=false` en change un.

## Tokens

Sous la bande, une ligne donne les tokens du dernier tour (entrée, sortie), le total de la session (sous-agents compris) et le remplissage du contexte. L'entrée compte aussi la part servie par le cache ; `/limites` détaille cette part. Les totaux partent du chargement du mod et repartent à zéro après `/clear`.

## Fable

Quand Claude Code remonte une limite propre à un modèle (par exemple `seven_day_fable`), sa barre n'apparaît que si ce modèle est sélectionné (`/model`), et remplace alors la barre « 7 j ». Sans limite Fable remontée, la barre « 7 j » reste.

## Configuration

Trois façons de régler le mod :

- `/usage-limits-config` : liste les réglages et leur valeur actuelle.
- `/usage-limits-config réglage=valeur` : en change un, par exemple `/usage-limits-config barHeight=10`. Pour les booléens, `true`/`false`, `on`/`off`, `oui`/`non` et `1`/`0` marchent tous.
- `/config` : les mêmes réglages, dans le menu de Claude Code.

### Paramètres

| Paramètre | Valeurs | Défaut | Effet |
|---|---|---|---|
| `windows` | `both`, `five_hour`, `seven_day` | `both` | Les limites affichées : les deux, ou seulement la session de 5 h, ou seulement la semaine. |
| `warnAt` | 1 à 100 (%) | `90` | Seuil d'alerte : à partir de là, la barre passe au rouge, le verdict devient « Limite proche » et une notification s'affiche. |
| `cautionAt` | 1 à 100 (%) | `70` | Seuil d'attention : à partir de là, la barre passe à l'orange. |
| `paceMargin` | 0 à 50 (points) | `8` | Zone neutre : tant que l'écart entre la consommation et le temps écoulé reste sous cette valeur, le rythme est « normal ». |
| `showDelta` | `true`, `false` | `false` | Écrit l'écart en points à côté de chaque barre, par exemple `+12`. |
| `showPaceMark` | `true`, `false` | `true` | Dessine sur chaque barre le trait qui marque le temps écoulé dans la fenêtre. |
| `showReset` | `true`, `false` | `true` | Ajoute sous la bande la ligne « Reset : session … · semaine … ». |
| `showTokens` | `true`, `false` | `true` | Ajoute sous la bande la ligne des tokens : dernier tour, session, contexte. |
| `barHeight` | 2 à 20 (px) | `6` | Épaisseur des barres. Le terminal dessine ses barres en texte et ignore ce réglage. |
| `bandPadding` | 0 à 3 (lignes) | `1` | Hauteur de la bande : marge au-dessus et au-dessous de son contenu. `0` la rend la plus basse possible. |
| `layout` | `auto`, `wide`, `medium`, `narrow` | `auto` | Disposition : `auto` s'adapte à la largeur, les autres en imposent une (large, moyenne, étroite). |
| `isCompact` | `true`, `false` | `false` | Style compact : pas de barre, seulement le nom de la limite et le pourcentage. |

### Exemples

```
/usage-limits-config barHeight=12
/usage-limits-config bandPadding=0
/usage-limits-config showTokens=off
/usage-limits-config windows=five_hour
/usage-limits-config warnAt=80
```

Quand un long prompt laisse peu de place, la bande retire d'elle-même, dans l'ordre, la ligne des tokens, la ligne des resets, la marge puis la bordure, quels que soient ces réglages.
