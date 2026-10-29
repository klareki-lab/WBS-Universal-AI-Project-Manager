/** Tab-local read state only. Never stores responses/credentials in persistent storage. */
export interface ReadOptions { signal?: AbortSignal; fresh?: boolean; includeDependencies?: boolean }
export interface RateState { until: number | null; limited: boolean; manual: boolean; requestId: string }
export interface ThrottledError extends Error { status: number; retryAt?: number | null; requestId?: string }
const listeners = new Set<() => void>();
let rate: RateState = { until: null, limited: false, manual: false, requestId: '' };
export const subscribeRate = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getRateState = () => rate;
function updateRate(next: RateState) { rate = next; for (const listener of listeners) listener(); }
export function retryAt(headers: Headers, now = Date.now()): number | null {
  const raw = headers.get('retry-after')?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) { const seconds = Number(raw); return Number.isSafeInteger(seconds) && seconds <= 2147483 ? now + seconds * 1000 : null; }
  // RFC 9110 HTTP-date. Do not guess from localized error text or arbitrary dates.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) return null;
  const deadline = Date.parse(raw); const serverDate = Date.parse(headers.get('date') ?? '');
  if (!Number.isFinite(deadline)) return null;
  const delay = Math.max(0, deadline - (Number.isFinite(serverDate) ? serverDate : now));
  return delay <= 2147483000 ? now + delay : null;
}
export function recordRateLimit(until: number | null, requestId: string) {
  updateRate({ limited: true, until: until === null ? null : Math.max(until, rate.until ?? 0), manual: until === null, requestId });
}
export function allowManualReadRetry() {
  // Never shorten a server-provided deadline. This action never resubmits a write.
  if (rate.until === null || rate.until <= Date.now()) updateRate({ until: null, limited: false, manual: false, requestId: '' });
}
export const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const aborted = () => new DOMException('Veraltete Leseanfrage abgebrochen.', 'AbortError');
function rateError(): ThrottledError {
  return Object.assign(new Error('Zu viele Anfragen. Bitte die angegebene Wartezeit beachten.'), { status: 429, retryAt: rate.until, requestId: rate.requestId });
}
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(aborted()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
// Shared limiter: at most two active GETs, including a serialized recovery wave.
let active = 0;
const slots: Array<() => void> = [];
async function slot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw aborted();
  const release = () => { const next = slots.shift(); if (next) next(); else active--; };
  if (active < 2) active++;
  else await new Promise<void>((resolve, reject) => {
    const ready = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const cancel = () => { const i = slots.indexOf(ready); if (i >= 0) slots.splice(i, 1); reject(aborted()); };
    signal.addEventListener('abort', cancel, { once: true }); slots.push(ready);
  });
  if (signal.aborted) { release(); throw aborted(); }
  let released = false;
  return () => { if (!released) { released = true; release(); } };
}

interface Entry { controller: AbortController; promise: Promise<unknown>; users: number }
const pending = new Map<string, Entry>();
const cache = new Map<string, { value: unknown; expires: number }>();
let generation = 0;
/** Writes/auth changes invalidate both successful reuse and pending-request deduplication. */
export function invalidateReads() { generation++; cache.clear(); }
export function resetReadsForTests() { for (const e of pending.values()) e.controller.abort(); pending.clear(); invalidateReads(); allowManualReadRetry(); updateRate({ until: null, limited: false, manual: false, requestId: '' }); }
export function coordinateRead<T>(path: string, load: (signal: AbortSignal) => Promise<T>, options: ReadOptions = {}, ttl = 5000): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(aborted());
  const gen = generation; const key = `${gen}:${path}`;
  const saved = cache.get(key);
  if (!options.fresh && saved && saved.expires > Date.now()) return Promise.resolve(structuredClone(saved.value) as T);
  let entry = pending.get(key);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    const promise = (async () => {
      let retries = 0;
      for (;;) {
        if (rate.manual) throw rateError();
        while (rate.until !== null && rate.until > Date.now()) await sleep(rate.until - Date.now(), controller.signal);
        if (rate.manual) throw rateError();
        const release = await slot(controller.signal);
        try {
          // A parallel response may have established a cooldown while we queued.
          if (rate.manual) throw rateError();
          if (rate.until !== null && rate.until > Date.now()) continue;
          const value = await load(controller.signal);
          if (controller.signal.aborted) throw aborted();
          if (gen === generation && ttl > 0) {
            if (cache.size >= 150) cache.delete(cache.keys().next().value!);
            cache.set(key, { value, expires: Date.now() + ttl });
          }
          if (rate.limited && !rate.manual && rate.until !== null && rate.until <= Date.now()) allowManualReadRetry();
          return value;
        } catch (error) {
          const e = error as ThrottledError;
          if (controller.signal.aborted) throw aborted();
          if (e?.status !== 429 || typeof e.retryAt !== 'number') throw error;
          if (retries++ >= 2) { updateRate({ ...rate, manual: true }); throw error; }
          // Retry only GETs, at most twice, using the server's exact interval.
        } finally { release(); }
      }
    })();
    entry = { controller, promise, users: 0 };
    pending.set(key, entry);
    const current = entry;
    void promise.finally(() => { if (pending.get(key) === current) pending.delete(key); }).catch(() => undefined);
  }
  const current = entry; current.users++;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true; options.signal?.removeEventListener('abort', cancel); current.users--;
      // React StrictMode can subscribe again before this microtask.
      queueMicrotask(() => { if (!current.users && pending.get(key) === current) { pending.delete(key); current.controller.abort(); } });
      return true;
    };
    const cancel = () => { if (finish()) reject(aborted()); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    current.promise.then(value => { if (finish()) resolve(structuredClone(value) as T); }, error => { if (finish()) reject(error); });
  });
}
