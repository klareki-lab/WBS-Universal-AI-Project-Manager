import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Clock3, LoaderCircle, Info, ShieldCheck } from 'lucide-react';
import type { OperationState, PlanStatus, ProjectStatus, TaskPriority, TaskStatus } from '../api/types';
import { de } from '../i18n/de';
import { dateDE } from '../utils/format';

export function PageHeader({ kicker, title, subtitle, action }: { kicker: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow mb-3">{kicker}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>{action}</div>;
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{children}</section>; }
export function DemoNotice({ compact = false }: { compact?: boolean }) {
  return <div className={`demo-notice ${compact ? 'py-2.5' : 'py-3.5'}`} role="note"><Info size={17} className="shrink-0 text-amber-600" aria-hidden="true" /><span><strong>{de.demo.title}.</strong> {de.demo.detail}</span></div>;
}
export function StatusBadge({ status }: { status: ProjectStatus | TaskStatus | PlanStatus | OperationState }) {
  const labels: Record<string, string> = { ...de.projectStatus, ...de.taskStatus, ...de.operationStatus, draft: 'Entwurf', approved: 'Freigegeben', superseded: 'Überholt', rejected: 'Abgelehnt' };
  const style: Record<string, string> = { planning: 'slate', active: 'blue', at_risk: 'amber', completed: 'green', todo: 'slate', in_progress: 'blue', blocked: 'red', done: 'green', draft: 'amber', approved: 'green', superseded: 'slate', rejected: 'red', queued: 'slate', running: 'blue', partial: 'amber', failed: 'red' };
  return <span className={`status-badge badge-${style[status] ?? 'slate'}`}><span className="status-dot" />{labels[status]}</span>;
}
export function PriorityBadge({ value }: { value: TaskPriority }) { return <span className={`priority-${value} text-xs font-semibold`}>{de.taskPriority[value]}</span>; }
export function ProgressBar({ value }: { value: number }) { return <div className="progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Projektfortschritt"><div className="progress-fill" style={{ width: `${value}%` }} /></div>; }
export function Loading({ label = de.common.loading }: { label?: string }) { return <div className="flex min-h-52 items-center justify-center gap-3 text-slate-500" role="status"><LoaderCircle className="animate-spin" size={22} />{label}</div>; }
export function ErrorState({ text, retry }: { text: string; retry?: () => void }) { return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800" role="alert"><div className="mb-2 flex items-center gap-2 font-bold"><AlertTriangle size={18} />Fehler</div><p className="text-sm">{text}</p>{retry && <button className="btn-secondary mt-3" onClick={retry}>{de.common.retry}</button>}</div>; }
export function EmptyState({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-500">{text}</div>; }
export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) { return <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-ink">{title}</h2>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>{right}</div>; }
export function DueDate({ date }: { date?: string }) { return <span className="inline-flex items-center gap-1.5 text-sm text-slate-500"><Clock3 size={14} />{dateDE(date)}</span>; }
export const StateIcon = ({ state }: { state: OperationState }) => state === 'failed' ? <AlertTriangle size={18} className="text-red-500" /> : state === 'completed' ? <CheckCircle2 size={18} className="text-emerald-600" /> : state === 'partial' ? <AlertTriangle size={18} className="text-amber-600" /> : state === 'running' ? <LoaderCircle size={18} className="text-blue-500" /> : <ShieldCheck size={18} className="text-slate-500" />;
