import { ChevronRight, GitBranch, Pencil, CalendarDays } from 'lucide-react';
import type { PlanVersion, Task } from '../api/types';
import { de } from '../i18n/de';
import { dateDE } from '../utils/format';
import { EmptyState, PriorityBadge, StatusBadge } from './UI';
export function ProjectPlan({ plan, onEdit, onView }: { plan: PlanVersion; onEdit?: (task: Task) => void; onView?: (task: Task) => void }) {
  if (!plan.tasks.length) return <EmptyState text={de.workspace.noTasks} />;
  return <div className="space-y-4">{[...plan.phases].sort((a, b) => a.order - b.order).map((phase, i) => {
    const tasks = plan.tasks.filter((task) => task.phaseId === phase.id);
    return <div className="phase-group" key={phase.id}><div className="phase-header"><div className="flex items-center gap-3"><span className="phase-number">{String(i + 1).padStart(2, '0')}</span><div><h3 className="font-bold text-ink">{phase.title}</h3><p className="text-xs text-slate-400">{tasks.length} {de.common.tasks}</p></div></div><ChevronRight size={18} className="text-slate-300" /></div>
      <div className="divide-y divide-slate-100">{tasks.map((task) => <div key={task.id} className="group flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{task.title}</span><PriorityBadge value={task.priority} /></div><div className="flex flex-wrap items-center gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><CalendarDays size={12} />{dateDE(task.dueDate)}</span><span>{task.estimateDays} {de.common.days}</span>{task.dependsOn.length > 0 && <span className="inline-flex items-center gap-1"><GitBranch size={12}/>{task.dependsOn.length} {de.workspace.linked.toLowerCase()}</span>}</div></div><div className="flex items-center gap-3"><StatusBadge status={task.status} />{onEdit ? <button className="icon-button" aria-label={`Aufgabe bearbeiten: ${task.title}`} onClick={() => onEdit(task)}><Pencil size={16}/></button> : onView ? <button className="icon-button" aria-label={`Aufgabe ansehen: ${task.title}`} onClick={() => onView(task)}><ChevronRight size={16}/></button> : null}</div></div>)}</div>
    </div>;
  })}</div>;
}
