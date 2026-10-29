import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { projectApi } from '../api';
import { explainError } from '../api/errors';
import type { Project } from '../api/types';
import type { ReadOptions } from '../live/readCoordinator';
import { useReadResource } from '../utils/useReadResource';
interface State { projects: Project[]; loading: boolean; error: string | null; selectedProjectId: string | null; setSelectedProjectId: (id: string) => void; refresh: () => Promise<void>; }
const AppContext = createContext<State | null>(null);
const emptyProjects: Project[] = [];
export function AppProvider({ children }: { children: ReactNode }) {
  const load = useCallback((options: ReadOptions) => projectApi.listProjects(options), []);
  const { data, loading, error, reload } = useReadResource('projects', load);
  const projects = data ?? emptyProjects;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  useEffect(() => { if (data) setSelectedProjectId(current => current && data.some(p => p.id === current) ? current : data[0]?.id ?? null); }, [data]);
  const refresh = useCallback(() => reload(), [reload]);
  const value = useMemo(() => ({ projects, loading, error: error ? explainError(error) : null, selectedProjectId, setSelectedProjectId, refresh }), [projects, loading, error, selectedProjectId, refresh]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export const useApp = () => { const value = useContext(AppContext); if (!value) throw new Error('AppProvider is missing'); return value; };
