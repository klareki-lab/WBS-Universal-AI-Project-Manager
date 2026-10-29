/** Optional typed transport for contract reconciliation. Intentionally no endpoint map. */
import { ApiError } from './errors';
export interface RouteMap { [operation: string]: { path: string; method: 'GET' | 'POST' | 'PATCH' | 'PUT' }; }
export interface HttpOptions { baseUrl: string; routes: RouteMap; getAccessToken?: () => Promise<string | undefined>; }
export class ConfigurableTransport {
  constructor(private readonly options: HttpOptions) {}
  async request<TResponse, TBody = unknown>(operation: string, body?: TBody, params: Record<string, string> = {}): Promise<TResponse> {
    const route = this.options.routes[operation];
    if (!route) throw new ApiError('UNAVAILABLE', `Backend-Vertrag für ${operation} noch nicht vereinbart.`, false);
    const path = route.path.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (!(key in params)) throw new ApiError('VALIDATION', `Fehlender Pfadparameter: ${key}`, false);
      return encodeURIComponent(params[key]);
    });
    const accessToken = await this.options.getAccessToken?.();
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
      method: route.method,
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new ApiError(response.status === 409 ? 'CONFLICT' : 'UNAVAILABLE', `Backend-Fehler HTTP ${response.status}`, response.status >= 500);
    return await response.json() as TResponse;
  }
}
