import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Task, TaskEdit } from '../api/types';
import { de } from '../i18n/de';
import { ErrorState } from './UI';
import { explainError } from '../api/errors';
interface Props { task: Task; allTasks: Task[]; onClose: () => void; onSave: (edit: TaskEdit) => Promise<void>; }
export function TaskEditor({ task, allTasks, onClose, onSave }: Props) {
  const [edit, setEdit] = useState<TaskEdit>({ title: task.title, description: task.description, status: task.status, priority: task.priority, estimateDays: task.estimateDays, dueDate: task.dueDate, dependsOn: task.dependsOn });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); previouslyFocused?.focus(); };
  }, [onClose, saving]);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(null); try { await onSave(edit); onClose(); } catch (e) { setError(explainError(e)); } finally { setSaving(false); } };
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-edit-title" className="h-full w-full max-w-lg overflow-auto bg-white px-6 py-7 shadow-float sm:px-9">
    <div className="mb-7 flex items-start justify-between"><div><p className="eyebrow mb-2">PLAN EDITOR</p><h2 id="task-edit-title" className="text-2xl font-bold text-ink">{de.editor.title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{de.editor.intro}</p></div><button className="icon-button" aria-label="Dialog schließen" onClick={onClose}><X size={20} /></button></div>
    <form onSubmit={(e) => void submit(e)} className="space-y-5">
      <label className="field-label">{de.editor.taskName}<input ref={focusRef} required maxLength={140} className="field-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
      <label className="field-label">{de.editor.description}<textarea className="field-input min-h-28" rows={4} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-4"><label className="field-label">{de.editor.priority}<select className="field-input" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value as TaskEdit['priority'] })}>{Object.entries(de.taskPriority).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <label className="field-label">{de.editor.status}<select className="field-input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as TaskEdit['status'] })}>{Object.entries(de.taskStatus).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <label className="field-label">{de.editor.effort}<input className="field-input" required min={1} max={365} type="number" value={edit.estimateDays} onChange={(e) => setEdit({ ...edit, estimateDays: Number(e.target.value) })} /></label>
      <label className="field-label">{de.editor.date}<input className="field-input" type="date" value={edit.dueDate || ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value || undefined })} /></label></div>
      <fieldset><legend className="field-label mb-3">{de.editor.dependencies}</legend><div className="max-h-44 space-y-2 overflow-auto rounded-xl border border-slate-200 p-3">{allTasks.filter((t) => t.id !== task.id).map((t) => <label key={t.id} className="flex cursor-pointer items-start gap-3 text-sm text-slate-700"><input type="checkbox" className="mt-1 accent-emerald-600" checked={edit.dependsOn.includes(t.id)} onChange={(e) => setEdit({ ...edit, dependsOn: e.target.checked ? [...edit.dependsOn, t.id] : edit.dependsOn.filter((id) => id !== t.id) })}/><span>{t.title}</span></label>)}</div></fieldset>
      {error && <ErrorState text={error} />}
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>{de.common.cancel}</button><button className="btn-primary" disabled={saving} type="submit">{saving ? 'Speichern …' : de.editor.save}</button></div>
    </form>
  </div></div>;
}
