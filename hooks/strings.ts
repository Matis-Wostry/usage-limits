// Every word the mod shows, one table per language. The manifest's labels are English:
// SETTINGS_FR gives the /config menu its French ones.

export type Verdict = 'push' | 'steady' | 'slow' | 'limit'

export type Strings = {
  decimal: string
  colon: string
  percent: (value: number) => string
  labels: Record<string, string>
  resetNames: Record<string, string>
  verdicts: Record<Verdict, string>
  dayUnit: string
  weekdays: readonly string[]
  clock: (hours: number, minutes: string) => string
  at: string
  resetLine: string
  resets: string
  inWord: string
  forecast: string
  forecastLimit: (label: string, time: string) => string
  toast: (label: string, percent: string) => string
  lastTurn: string
  turnShort: string
  session: string
  context: string
  contextShort: string
  input: string
  output: string
  cached: (read: string, written: string) => string
  model: (model: string, shown: string) => string
  vsTime: (gap: string, glyph: string) => string
  tipUsed: (label: string, percent: string) => string
  tipElapsed: (percent: string) => string
  noFigures: string
  hidden: string
  commands: { show: string; hide: string; history: string }
  commandHelp: { show: string; hide: string; history: string; config: string }
  configHint: string
  configHeader: string
  configUnknown: (name: string) => string
  configBoolean: (name: string) => string
  configNumber: (name: string) => string
  configChoice: (name: string, options: string) => string
  configDenied: (reason: string) => string
  historyTitle: string
  historyHint: string
  historyEmpty: string
  historyOpened: string
  historyDate: (day: string, month: string) => string
}

export const STRINGS: Record<'fr' | 'en', Strings> = {
  fr: {
    decimal: ',',
    colon: ' : ',
    percent: value => `${value} %`,
    labels: { five_hour: '5 h', seven_day: '7 j', spend_limit: 'Budget' },
    resetNames: { five_hour: 'session', seven_day: 'semaine', spend_limit: 'budget' },
    verdicts: { push: 'Pousser', steady: 'Rythme normal', slow: 'Ralentir', limit: 'Limite proche' },
    dayUnit: 'j',
    weekdays: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
    clock: (hours, minutes) => `${hours} h ${minutes}`,
    at: 'à',
    resetLine: 'Reset : ',
    resets: 'reset',
    inWord: 'dans',
    forecast: 'À ce rythme : ',
    forecastLimit: (label, time) => `limite ${label} dans ${time}`,
    toast: (label, percent) => `Limite ${label} à ${percent}`,
    lastTurn: 'Dernier tour',
    turnShort: 'Tour',
    session: 'Session',
    context: 'Contexte',
    contextShort: 'Ctx',
    input: 'entrée',
    output: 'sortie',
    cached: (read, written) => `dont cache lu ${read}, écrit ${written}`,
    model: (model, shown) => `Modèle : ${model} (bande : ${shown})`,
    vsTime: (gap, glyph) => `${gap} pts par rapport au temps, ${glyph}`,
    tipUsed: (label, percent) => `${label} : ${percent} consommé`,
    tipElapsed: percent => `${percent} du temps écoulé (repère noir)`,
    noFigures: 'Aucun chiffre remonté pour l’instant.',
    hidden: 'Bande masquée. /limites la fait revenir.',
    commands: { show: 'limites', hide: 'limites-masquer', history: 'limites-historique' },
    commandHelp: {
      show: 'Affiche le détail des limites et fait revenir la bande',
      hide: 'Masque la bande des limites (/limites la fait revenir)',
      history: 'Ouvre le panneau d’historique des limites',
      config: 'Affiche ou change les réglages de usage-limits',
    },
    configHint: '[réglage=valeur]',
    configHeader: 'Réglages de usage-limits (change avec /usage-limits-config réglage=valeur) :',
    configUnknown: name => `Réglage inconnu : ${name}`,
    configBoolean: name => `${name} attend true ou false.`,
    configNumber: name => `${name} attend un nombre.`,
    configChoice: (name, options) => `${name} attend : ${options}`,
    configDenied: reason => `Refusé : ${reason}`,
    historyTitle: 'Historique',
    historyHint: 'Pic de chaque limite par jour · tokens hors lecture du cache',
    historyEmpty: 'Pas encore de données.',
    historyOpened: 'Panneau d’historique ouvert.',
    historyDate: (day, month) => `${day}/${month}`,
  },
  en: {
    decimal: '.',
    colon: ': ',
    percent: value => `${value}%`,
    labels: { five_hour: '5 h', seven_day: '7 d', spend_limit: 'Budget' },
    resetNames: { five_hour: 'session', seven_day: 'week', spend_limit: 'budget' },
    verdicts: { push: 'Push', steady: 'On pace', slow: 'Slow down', limit: 'Near limit' },
    dayUnit: 'd',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    clock: (hours, minutes) => `${String(hours).padStart(2, '0')}:${minutes}`,
    at: 'at',
    resetLine: 'Reset: ',
    resets: 'resets',
    inWord: 'in',
    forecast: 'At this pace: ',
    forecastLimit: (label, time) => `${label} limit in ${time}`,
    toast: (label, percent) => `${label} limit at ${percent}`,
    lastTurn: 'Last turn',
    turnShort: 'Turn',
    session: 'Session',
    context: 'Context',
    contextShort: 'Ctx',
    input: 'input',
    output: 'output',
    cached: (read, written) => `cached read ${read}, written ${written}`,
    model: (model, shown) => `Model: ${model} (band: ${shown})`,
    vsTime: (gap, glyph) => `${gap} pts vs time, ${glyph}`,
    tipUsed: (label, percent) => `${label}: ${percent} used`,
    tipElapsed: percent => `${percent} of the time elapsed (black mark)`,
    noFigures: 'No usage figure reported yet.',
    hidden: 'Band hidden. /limits brings it back.',
    commands: { show: 'limits', hide: 'limits-hide', history: 'limits-history' },
    commandHelp: {
      show: 'Show the usage limits in detail and bring the band back',
      hide: 'Hide the usage limits band (/limits brings it back)',
      history: 'Open the usage limits history pane',
      config: 'Show or change the usage-limits settings',
    },
    configHint: '[setting=value]',
    configHeader: 'usage-limits settings (change with /usage-limits-config setting=value):',
    configUnknown: name => `Unknown setting: ${name}`,
    configBoolean: name => `${name} expects true or false.`,
    configNumber: name => `${name} expects a number.`,
    configChoice: (name, options) => `${name} expects: ${options}`,
    configDenied: reason => `Denied: ${reason}`,
    historyTitle: 'History',
    historyHint: 'Peak of each limit per day · tokens without cache reads',
    historyEmpty: 'No data yet.',
    historyOpened: 'History pane opened.',
    historyDate: (day, month) => `${month}/${day}`,
  },
}

export const SETTINGS_FR: Record<string, { label: string; description: string }> = {
  language: { label: 'Langue', description: 'Langue de la bande, des commandes, des messages et de ce menu.' },
  windows: { label: 'Limites affichées', description: 'Les limites que montre la bande : les deux, seulement 5 h ou seulement 7 jours.' },
  warnAt: { label: 'Seuil d’alerte (%)', description: 'Dès cette consommation, la barre passe au rouge et une notification s’affiche.' },
  cautionAt: { label: 'Seuil d’attention (%)', description: 'Dès cette consommation, la barre passe à l’orange.' },
  paceMargin: { label: 'Zone neutre (points)', description: 'Écart entre consommation et temps écoulé sous lequel le rythme reste normal.' },
  showDelta: { label: 'Afficher l’écart en points', description: 'Écrit l’écart de rythme à côté de chaque barre, par exemple +12.' },
  showPaceMark: { label: 'Afficher le repère de temps', description: 'Dessine le trait qui marque le temps écoulé sur chaque barre. Désactivé : la barre ne montre que la consommation.' },
  showForecast: { label: 'Prévoir l’épuisement', description: 'Écrit quand la limite sera atteinte à ce rythme, si c’est avant le reset.' },
  showReset: { label: 'Afficher le reset', description: 'Écrit le moment où chaque limite repart à zéro.' },
  resetFormat: { label: 'Format du reset', description: 'duration écrit le temps restant ; clock écrit l’heure du reset.' },
  layout: { label: 'Disposition', description: 'auto s’adapte à la largeur ; wide, medium ou narrow en impose une.' },
  barHeight: { label: 'Épaisseur des barres (px)', description: 'Épaisseur de chaque barre, en pixels. Le terminal dessine ses barres en texte et l’ignore.' },
  bandPadding: { label: 'Hauteur de la bande (lignes)', description: 'Marge au-dessus et au-dessous du contenu, en lignes. 0 rend la bande la plus basse possible.' },
  showTokens: { label: 'Afficher les tokens', description: 'Écrit sous la bande les tokens du dernier tour, le total de la session et le remplissage du contexte.' },
  isCompact: { label: 'Style compact', description: 'Retire les barres : seulement le nom de la limite et le pourcentage.' },
  history: { label: 'Panneau d’historique', description: 'Enregistre chaque jour le pic de chaque limite et les tokens, et ouvre le panneau à chaque session.' },
}
