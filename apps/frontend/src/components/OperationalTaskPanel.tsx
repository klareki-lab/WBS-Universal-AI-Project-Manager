import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { de } from '../i18n/de';
import type { OperationalTaskPatch, Task, TaskPriority, TaskStatus, User } from '../api/types';
import { ErrorState } from './UI';
import { explainError } from '../api/errors';
export function OperationalTaskPanel({task,tasks,members,onClose,onSave}:{task:Task;tasks:Task[];members:User[];onClose:()=>void;onSave:(patch:OperationalTaskPatch)=>Promise<void>}) {
  const [patch,setPatch]=useState<OperationalTaskPatch>({title:task.title,description:task.description,status:task.status,priority:task.priority,dueDate:task.dueDate,assigneeId:task.assigneeId,dependsOn:task.dependsOn});
  const [saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);const input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;input.current?.focus();const key=(event:KeyboardEvent)=>{
    if(event.key==='Escape'&&!saving)onClose();if(event.key!=='Tab'||!dialog.current)return;
    const nodes=Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])'));
    if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes[nodes.length-1]?.focus();}
    if(!event.shiftKey&&document.activeElement===nodes[nodes.length-1]){event.preventDefault();nodes[0]?.focus();}
  };document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[onClose,saving]);
  const submit=async(e:FormEvent)=>{e.preventDefault();setSaving(true);setError(null);try{await onSave(patch);onClose();}catch(err){setError(explainError(err));}finally{setSaving(false);}};
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)onClose();}}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="operational-task-title" className="h-full w-full max-w-lg overflow-auto bg-white px-6 py-7 shadow-float sm:px-9">
    <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{de.v2.board.direct}</p><h2 id="operational-task-title" className="mt-2 text-2xl font-bold text-ink">{de.v2.board.edit}</h2></div><button type="button" className="icon-button" aria-label="Details schließen" onClick={onClose}><X size={20}/></button></div>
    <form className="mt-7 space-y-5" onSubmit={e=>void submit(e)}>
      <label className="field-label">{de.editor.taskName}<input ref={input} required maxLength={140} className="field-input" value={patch.title??''} onChange={e=>setPatch({...patch,title:e.target.value})}/></label>
      <label className="field-label">{de.editor.description}<textarea className="field-input" rows={4} value={patch.description??''} onChange={e=>setPatch({...patch,description:e.target.value})}/></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="field-label">{de.editor.status}<select className="field-input" value={patch.status} onChange={e=>setPatch({...patch,status:e.target.value as TaskStatus})}>{Object.entries(de.taskStatus).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field-label">{de.editor.priority}<select className="field-input" value={patch.priority} onChange={e=>setPatch({...patch,priority:e.target.value as TaskPriority})}>{Object.entries(de.taskPriority).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field-label">{de.v2.board.assignee}<select className="field-input" value={patch.assigneeId??''} onChange={e=>setPatch({...patch,assigneeId:e.target.value||undefined})}><option value="">{de.v2.board.unassigned}</option>{members.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
      <label className="field-label">{de.editor.date}<input type="date" className="field-input" value={patch.dueDate??''} onChange={e=>setPatch({...patch,dueDate:e.target.value||undefined})}/></label></div>
      <fieldset><legend className="field-label mb-2">{de.v2.board.dependent}</legend><div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-4">{tasks.filter(t=>t.id!==task.id).map(t=><label className="flex gap-2 text-sm" key={t.id}><input type="checkbox" checked={(patch.dependsOn??[]).includes(t.id)} onChange={e=>setPatch({...patch,dependsOn:e.target.checked?[...(patch.dependsOn??[]),t.id]:(patch.dependsOn??[]).filter(id=>id!==t.id)})}/><span>{t.title}</span></label>)}</div></fieldset>
      {error&&<ErrorState text={error}/>}<div className="flex justify-end gap-3 border-t pt-5"><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>{de.common.cancel}</button><button className="btn-primary" type="submit" disabled={saving}>{saving?'Speichern …':de.v2.board.save}</button></div>
    </form></div></div>;
}
