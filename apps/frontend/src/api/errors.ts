export class ApiError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'UNAVAILABLE', message: string, public readonly retrySafe: boolean) {
    super(message);
    this.name = 'ApiError';
  }
}
export const explainError = (error: unknown): string => {
  if (error instanceof ApiError) return `${error.message} ${error.retrySafe ? 'Ein erneuter Versuch ist sicher.' : 'Nicht erneut senden; zuerst den Stand aktualisieren.'}`;
  if (error instanceof Error && 'status' in error) {
    const descriptions: Record<number, string> = {
      401: 'Sitzung abgelaufen. Bitte erneut anmelden.',
      403: 'Zugriff verweigert. Die Sitzung ist nicht automatisch beendet; Rechte oder CSRF-Status pr\u00fcfen.',
      404: 'Dieses Projekt oder Objekt ist nicht verf\u00fcgbar.',
      409: 'Versionskonflikt. Bitte aktuellen Stand neu laden und die \u00c4nderung erneut pr\u00fcfen.',
      429: 'Zu viele Anfragen. Die Server-Wartezeit wird beachtet. Schreibaktionen werden nicht automatisch wiederholt.',
      400: 'Eingabe wurde abgelehnt. Bitte die Felder pr\u00fcfen.',
    };
    const status = Number(error.status);
    const code= 'code' in error ? String(error.code) : '';
    const g6:Record<string,string>={
      self_dependency_not_allowed:'Eine Aufgabe darf nicht von sich selbst abhängen.',
      duplicate_dependency:'Diese Abhängigkeit wurde mehrfach ausgewählt.',
      invalid_dependency_reference:'Mindestens eine abhängige Aufgabe gehört nicht zu diesem Projekt oder ist nicht mehr verfügbar.',
      invalid_assignee:'Die ausgewählte Person ist kein aktives menschliches Projektmitglied mehr. Bitte die Mitgliederliste neu laden.',
      dependencies_incomplete:'Die Vorgängeraufgaben sind noch nicht abgeschlossen.',
    };
    const message=code==='invalid_plan'&&/cycle|zyklus|kreis/i.test(error.message)
      ? 'Diese Abhängigkeiten erzeugen einen Zyklus. Bitte mindestens eine Verbindung entfernen.'
      :g6[code]??descriptions[status]??error.message;
    return message + ('code' in error ? ` (${String(error.code)})` : '') + ('requestId' in error && error.requestId ? ' \u00b7 Request-ID '+String(error.requestId) : '');
  }
  return error instanceof Error ? error.message : 'Unerwarteter Fehler. Bitte aktuellen Stand pr\u00fcfen.';
};
