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

## Où ça s'affiche

La bande s'affiche dans **VS Code**. Elle n'apparaît pas dans l'onglet Code de l'application bureau. Si elle manque, tape `/limites` : une réponse avec des chiffres prouve que le mod est chargé.

## Commandes

- `/limites` : détail en texte, et fait revenir la bande si elle est masquée.
- `/limites-masquer` : masque la bande.
- `/usage-limits-config` : liste les réglages du mod ; `/usage-limits-config showPaceMark=false` en change un.

## Réglages

Avec `/usage-limits-config` (ou dans `/config`) : fenêtres affichées, seuil d'alerte (90 %), seuil d'attention (70 %), zone neutre (8 points), écart en points, repère du temps écoulé sur les barres (trait noir ou blanc, activé par défaut), temps restant, style compact.
