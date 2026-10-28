export class ApiError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'UNAVAILABLE', message: string, public readonly retrySafe: boolean) {
    super(message);
    this.name = 'ApiError';
  }
}
export const explainError = (error: unknown): string =>
  error instanceof ApiError ? `${error.message} ${error.retrySafe ? 'Ein erneuter Versuch ist sicher.' : 'Nicht erneut senden; zuerst den Stand aktualisieren.'}` :
  'Unerwarteter Fehler. Bitte den aktuellen Stand prüfen, bevor du eine Aktion wiederholst.';
