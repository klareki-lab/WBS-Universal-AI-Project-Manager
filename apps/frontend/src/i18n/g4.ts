/** System copy only. User-authored project content is never translated. */
export const g4 = {
  rateTitle: 'Anfragen kurz pausiert',
  countdown: (seconds: number) => `Der Server begrenzt vor\u00fcbergehend Anfragen. Automatisches Laden in ${seconds} Sekunden.`,
  restoring: 'Wartezeit beendet. Ausstehende Leseanfragen werden erneut geladen.',
  unknown: 'Der Server hat keine lesbare Wartezeit angegeben. Bitte sp\u00e4ter erneut laden.',
  preserved: 'Route, Projektauswahl und Eingaben bleiben erhalten. Schreibaktionen werden nicht automatisch wiederholt.',
  retry: 'Lesedaten erneut laden',
  live: 'VERBUNDEN',
  liveDetail: 'Änderungen werden gespeichert. Planinhalte benötigen eine Freigabe.',
  taskTitle: 'Aufgabendetails',
  taskMode: 'STATUS BEARBEITEN',
  taskPolicy: 'Titel, Beschreibung, Priorit\u00e4t, Termine, Zust\u00e4ndigkeit und Abh\u00e4ngigkeiten sind hier schreibgesch\u00fctzt. Inhaltliche \u00c4nderungen ben\u00f6tigen eine neue Planversion, Pr\u00fcfung und menschliche Freigabe.',
  taskSave: 'Status speichern',
  taskSaved: 'Status gespeichert.',
  taskNoChange: 'Keine Status\u00e4nderung ausgew\u00e4hlt.',
  planLink: 'Zum Planungsstudio',
  tasksEmpty: 'Noch keine ver\u00f6ffentlichten Aufgaben. Erstelle einen Planentwurf und pr\u00fcfe ihn vor Freigabe und Ver\u00f6ffentlichung.',
  events: 'Projektaktivitäten',
  eventsDetail: 'Gespeicherte Änderungen im ausgewählten Projekt.',
  activitySubtitle: 'Gespeicherte \u00c4nderungen und tats\u00e4chliche Vorg\u00e4nge des ausgew\u00e4hlten Projekts.',
  jobs: 'KI-Bearbeitungen',
  jobsDetail: 'Die letzten bis zu 100 Bearbeitungen.',
  jobsEmpty: 'Noch keine Vorg\u00e4nge f\u00fcr dieses Projekt.',
  eventsEmpty: 'Noch keine Ereignisse f\u00fcr dieses Projekt.',
  jobRetry: 'Vorgangsstatus kann erneut gelesen werden. Ein fehlgeschlagener Vorgang wird nicht automatisch neu gestartet.',
  selectProject: 'Bitte ein Projekt ausw\u00e4hlen.',
  create: 'Projekt erstellen',
  language: 'Projektname und Beschreibung bleiben in der eingegebenen Sprache. Navigation und Systemmeldungen sind Deutsch.',
  natural: 'Die Beschreibung wird unver\u00e4ndert gespeichert. Bitte den Projektnamen selbst angeben. Hier wird keine KI aufgerufen.',
  unavailableFields: 'Kategorie, Zieldatum, Budget und Rahmenbedingungen können derzeit nicht gespeichert werden.',
  storage: 'Änderungen werden dauerhaft gespeichert.',
  backendSession: 'Du bist angemeldet. Deine Zugriffsrechte werden geprüft.',
  ai: 'Der Stand und das Ergebnis jeder KI-Planung werden angezeigt.',
  aiLanguage: 'Eine gew\u00fcnschte Ausgabesprache kann im Planungsziel stehen. Ihre Einhaltung ist nicht technisch garantiert.',
  planningSubmitted: 'Planungsauftrag erstellt. Der Plan ist noch nicht freigegeben oder veröffentlicht.',
  operationRecord: 'GESPEICHERTER PLANUNGSAUFTRAG',
  noQuestions: 'Freie Fragen sind derzeit nicht verfügbar. Hier kannst du eine Planung anfordern.',
  operationNotText: 'Dies ist der Stand der Bearbeitung. Er ist keine Freigabe.',
} as const;

export const activityNames: Record<string,string> = {
 'company.attached': 'Unternehmensverzeichnis verbunden',
 'member.added': 'Teammitglied hinzugefügt', 'member.role_changed': 'Rolle im Projektteam geändert', 'member.removed': 'Teammitglied entfernt',
 'project.created': 'Projekt erstellt', 'project.updated': 'Projekt aktualisiert',
 'task.status_changed': 'Aufgabenstatus ge\u00e4ndert', 'task.status_updated': 'Aufgabenstatus aktualisiert',
 'plan.created': 'Planentwurf erstellt', 'plan.review_requested': 'Plan zur Pr\u00fcfung eingereicht',
 'plan.submitted': 'Plan eingereicht', 'plan.approved': 'Plan freigegeben', 'plan.rejected': 'Plan abgelehnt',
 'plan.published': 'Plan ver\u00f6ffentlicht', 'plan.approval_requested': 'Freigabe angefordert',
 'approval.revoked': 'Freigabe widerrufen', 'operation.queued': 'KI-Bearbeitung gestartet',
 'operation.running': 'KI-Bearbeitung läuft', 'operation.succeeded': 'KI-Bearbeitung abgeschlossen',
 'operation.failed': 'KI-Bearbeitung fehlgeschlagen'
};

/** Preserve the integration owner's d22b0c3 safe planning-failure guidance. */
export const planningFailureMessage = (code: string | null): string =>
  code === 'Retry budget exhausted' ? 'Die Planung wurde nach mehreren Versuchen beendet. Bitte den Dienst prüfen und bei Bedarf eine neue Planung anfordern.' :
  code === 'Automation delivery or result validation failed' ? 'Die Planung konnte nicht zugestellt oder ihr Ergebnis nicht verarbeitet werden. Bitte den Dienst prüfen.' :
  code === 'Automation failed' ? 'Der Planungsdienst konnte den Auftrag nicht abschließen. Bitte den Dienst prüfen.' :
  code === 'AI_BUDGET_EXHAUSTED' ? 'Das freigegebene AI-Budget ist ausgesch\u00f6pft. Bitte die verantwortliche Person um eine Budgetentscheidung bitten.' :
  code === 'AI_CONCURRENCY_LIMIT' ? 'Der AI-Dienst bearbeitet bereits mehrere Anfragen. Bitte sp\u00e4ter eine neue Planung anfordern.' :
  'Die AI-Planung ist fehlgeschlagen. Dienst und Konfiguration pr\u00fcfen, dann bei Bedarf eine neue Planung anfordern.';
