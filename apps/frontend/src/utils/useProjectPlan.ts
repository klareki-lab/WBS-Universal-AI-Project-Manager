import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { projectApi } from '../api';
import { explainError } from '../api/errors';
import type { PlanVersion, Project } from '../api/types';
export function useProjectPlan() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<PlanVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try { const current = await projectApi.getProject(projectId); const selected = current.activeDraftVersionId || current.approvedPlanVersionId; const fallback = selected ? null : (await projectApi.listPlans(current.id))[0]; setProject(current); setPlan(selected ? await projectApi.getPlan(selected) : fallback ?? null); setError(null); }
    catch (e) { setError(explainError(e)); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload]);
  return { projectId, project, plan, setPlan, loading, error, reload };
}
