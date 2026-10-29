import { useCallback, useEffect, useRef, useState } from 'react';
import { allowManualReadRetry, isAbort, type ReadOptions } from '../live/readCoordinator';

/** A route-owned read. A late result may never replace data of a different project. */
export function useReadResource<T>(key: string, load: (options: ReadOptions) => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown; loading: boolean }>({ key, loading: true });
  const current = useRef<AbortController>();
  const reload = useCallback(async (fresh = true) => {
    current.current?.abort();
    const controller = new AbortController(); current.current = controller;
    if (fresh) allowManualReadRetry();
    setState(old => ({ key, data: old.key === key ? old.data : undefined, loading: true }));
    try {
      const data = await load({ signal: controller.signal, fresh });
      if (!controller.signal.aborted) setState({ key, data, loading: false });
    } catch (error) {
      if (!controller.signal.aborted && !isAbort(error)) setState(old => ({ key, data: old.key === key ? old.data : undefined, error, loading: false }));
    }
  }, [key, load]);
  useEffect(() => {
    void reload(false);
    const retry = () => { void reload(); };
    window.addEventListener('uapm-read-retry', retry);
    return () => { current.current?.abort(); window.removeEventListener('uapm-read-retry', retry); };
  }, [reload]);
  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : undefined, loading: state.key !== key || state.loading, reload };
}
