import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { projectApi } from '../api';
import { explainError } from '../api/errors';
import type { Project } from '../api/types';
import type { ReadOptions } from '../live/readCoordinator';
import { useReadResource } from '../utils/useReadResource';
interface State { focusProject: boolean; setFocusProject: (value: boolean) => void; projects: Project[]; loading: boolean; error: string | null; selectedProjectId: string | null; setSelectedProjectId: (id: string) => void; refresh: () => Promise<void>; }
const AppContext = createContext<State | null>(null);
const emptyProjects: Project[] = [];
export function AppProvider({ children }: { children: ReactNode }) {
  const load = useCallback((options: ReadOptions) => projectApi.listProjects(options), []);
  const { data, loading, error, reload } = useReadResource('projects', load);
  const [focusProject, setFocusProject] = useState(() => sessionStorage.getItem('uapm.projectFocus') === '1');
  useEffect(() => { if (focusProject) sessionStorage.setItem('uapm.projectFocus', '1'); else sessionStorage.removeItem('uapm.projectFocus'); }, [focusProject]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => sessionStorage.getItem('uapm.selectedProject'));
  useEffect(() => { if (selectedProjectId) sessionStorage.setItem('uapm.selectedProject', selectedProjectId); else sessionStorage.removeItem('uapm.selectedProject'); }, [selectedProjectId]);
  useEffect(() => { if (data) setSelectedProjectId(current => current && data.some(p => p.id === current) ? current : data[0]?.id ?? null); }, [data]);
  // Presentation filter only: the backend remains authoritative and permissions are unchanged.
  const projects = useMemo(() => focusProject && selectedProjectId ? (data ?? emptyProjects).filter(p => p.id === selectedProjectId) : data ?? emptyProjects, [data, focusProject, selectedProjectId]);
  const refresh = useCallback(() => reload(), [reload]);
  const value = useMemo(() => ({ projects, loading, error: error ? explainError(error) : null, selectedProjectId, setSelectedProjectId, refresh, focusProject, setFocusProject }), [projects, loading, error, selectedProjectId, refresh, focusProject]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export const useApp = () => { const value = useContext(AppContext); if (!value) throw new Error('AppProvider is missing'); return value; };
