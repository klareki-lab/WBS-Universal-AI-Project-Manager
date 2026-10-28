import { ApiError } from '../api/errors';
import type { PlanChange, PlanVersion, Task } from '../api/types';
/** Compare immutable task contents; operational status and assignee are not planning attributes. */
function shape(task: Task) { return { title: task.title, description: task.description, phaseId: task.phaseId, priority: task.priority, estimateDays: task.estimateDays, dueDate: task.dueDate, dependsOn: [...task.dependsOn].sort() }; }
export function computePlanChanges(base: PlanVersion | undefined, candidate: PlanVersion): PlanChange[] {
  const before = new Map(base?.tasks.map((task) => [task.id, task]) ?? []);
  const after = new Map(candidate.tasks.map((task) => [task.id, task]));
  const changes: PlanChange[] = [];
  for (const item of candidate.tasks) {
    const old = before.get(item.id);
    if (!old) changes.push({ taskId: item.id, action: 'added', after: structuredClone(item) });
    else if (JSON.stringify(shape(old)) !== JSON.stringify(shape(item))) changes.push({ taskId: item.id, action: 'modified', before: structuredClone(old), after: structuredClone(item) });
  }
  for (const item of base?.tasks ?? []) if (!after.has(item.id)) changes.push({ taskId: item.id, action: 'removed', before: structuredClone(item) });
  return changes;
}
export function validateDependencies(tasks: Task[]) {
  const map = new Map(tasks.map((t) => [t.id, t.dependsOn]));
  const seen = new Set<string>(); const visiting = new Set<string>();
  const visit = (id: string) => {
    if (!map.has(id)) throw new ApiError('VALIDATION', 'Unbekannte Aufgaben-Abhängigkeit.', false);
    if (visiting.has(id)) throw new ApiError('VALIDATION', 'Zirkuläre Abhängigkeit ist nicht erlaubt.', false);
    if (seen.has(id)) return;
    visiting.add(id);
    for (const dep of map.get(id)!) visit(dep);
    visiting.delete(id); seen.add(id);
  };
  for (const id of map.keys()) visit(id);
}
