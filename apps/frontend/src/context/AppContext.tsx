import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { projectApi } from '../api';
import { explainError } from '../api/errors';
import type { Project } from '../api/types';
interface State { projects: Project[]; loading: boolean; error: string | null; selectedProjectId: string | null; setSelectedProjectId: (id: string) => void; refresh: () => Promise<void>; }
const AppContext = createContext<State | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setError(null); const items = await projectApi.listProjects(); setProjects(items); setSelectedProjectIdState((current) => current && items.some((p) => p.id === current) ? current : items[0]?.id ?? null); }
    catch (e) { setError(explainError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const setSelectedProjectId = useCallback((id: string) => setSelectedProjectIdState(id), []);
  const value = useMemo(() => ({ projects, loading, error, selectedProjectId, setSelectedProjectId, refresh }), [projects, loading, error, selectedProjectId, setSelectedProjectId, refresh]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export const useApp = () => { const value = useContext(AppContext); if (!value) throw new Error('AppProvider is missing'); return value; };
