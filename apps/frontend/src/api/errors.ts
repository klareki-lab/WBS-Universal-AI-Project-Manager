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
    const message = descriptions[status] ?? error.message;
    return message + ('code' in error ? ` (${String(error.code)})` : '') + ('requestId' in error && error.requestId ? ' \u00b7 Request-ID '+String(error.requestId) : '');
  }
  return error instanceof Error ? error.message : 'Unerwarteter Fehler. Bitte aktuellen Stand pr\u00fcfen.';
};
