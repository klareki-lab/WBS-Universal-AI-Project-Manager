import { isDemoMode } from '../api';
import { Link } from 'react-router-dom';
import { g4 } from '../i18n/g4';
import { taskEditing } from '../i18n/taskEditing';
import { createTaskChange, taskContentChanges } from '../api/taskChanges';
import type { Plan } from '../live/client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, PenLine } from 'lucide-react';
import { de } from '../i18n/de';
import type { OperationalTaskPatch, Task, TaskPriority, TaskStatus, User } from '../api/types';
import { ErrorState } from './UI';
import { explainError } from '../api/errors';

export function OperationalTaskPanel({task,tasks,members,onClose,onSave}:{task:Task;tasks:Task[];members:User[];onClose:()=>void;onSave:(patch:OperationalTaskPatch)=>Promise<void>}) {
  const original=():OperationalTaskPatch=>({title:task.title,description:task.description,status:task.status,priority:task.priority,dueDate:task.dueDate,assigneeId:task.assigneeId,dependsOn:task.dependsOn});
  const [patch,setPatch]=useState<OperationalTaskPatch>(original);
  const [editing,setEditing]=useState(false),[saved,setSaved]=useState<Plan|null>(null),[savedSignature,setSavedSignature]=useState('');
  const [saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
  const input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDivElement>(null),submitting=useRef(false);
  const busyRef=useRef(saving),closeRef=useRef(onClose);busyRef.current=saving;closeRef.current=onClose;
  const changes=taskContentChanges(task,{title:patch.title,description:patch.description,priority:patch.priority,dueDate:patch.dueDate??null,assigneeId:patch.assigneeId??null});
  const signature=JSON.stringify(changes),dirty=Object.keys(changes).length>0;
  const statusChanged=patch.status!==task.status;
  const editable=isDemoMode||editing;
  const change=(next:OperationalTaskPatch)=>{setPatch(next);setError(null);};
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    input.current?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!busyRef.current)closeRef.current();
      if(event.key!=='Tab'||!dialog.current)return;
      const nodes=Array.from(dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])'));
      if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes[nodes.length-1]?.focus();}
      if(!event.shiftKey&&document.activeElement===nodes[nodes.length-1]){event.preventDefault();nodes[0]?.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);previous?.focus();};
  },[]);
  useEffect(()=>{if(editing)input.current?.focus();},[editing]);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(submitting.current)return;
    if(!isDemoMode&&editing&&(!dirty||signature===savedSignature))return;
    if(!isDemoMode&&!editing&&!statusChanged)return;
    submitting.current=true;setSaving(true);setError(null);
    try{
      if(!isDemoMode&&editing){
        const plan=await createTaskChange(task,changes);
        setSaved(plan);setSavedSignature(signature);
        // Do NOT replace the persisted task or claim it has been published.
      }else{await onSave(isDemoMode?patch:{status:patch.status});onClose();}
    }catch(err){setError(explainError(err));}
    finally{submitting.current=false;setSaving(false);}
  };
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)onClose();}}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="operational-task-title" className="h-full w-full max-w-lg overflow-auto bg-white px-6 py-7 shadow-float sm:px-9">
      <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{isDemoMode?de.v2.board.direct:editing?taskEditing.editing:g4.taskMode}</p><h2 id="operational-task-title" className="mt-2 text-2xl font-bold text-ink">{isDemoMode?de.v2.board.edit:editing?taskEditing.title:g4.taskTitle}</h2></div><button type="button" disabled={saving} className="icon-button" aria-label={taskEditing.close} onClick={onClose}><X size={20}/></button></div>
      {!isDemoMode&&<div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
        <p>{editing?taskEditing.draftPolicy:taskEditing.policy}</p>
        {!editing&&<button type="button" className="btn-primary mt-3" disabled={saving||statusChanged} onClick={()=>{setEditing(true);setError(null);}}><PenLine size={16}/>{taskEditing.edit}</button>}
        {!editing&&statusChanged&&<p className="mt-2 text-xs">{taskEditing.statusFirst}</p>}
        <p className="mt-2 break-all text-xs">Version: {task.version} - {task.id}</p>
      </div>}
      {saved&&signature===savedSignature&&<section role="status" data-testid="task-draft-saved" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <p className="font-semibold">{taskEditing.saved(saved.number)}</p>
        <p className="mt-2 break-all font-mono text-xs">{saved.id}</p>
        <p className="mt-1 break-all font-mono text-xs">SHA-256: {saved.content_hash}</p>
        <Link className="btn-primary mt-3" to={`/projects/${task.projectId}/review?plan=${encodeURIComponent(saved.id)}`}>{taskEditing.review}</Link>
      </section>}
      <form className="mt-7 space-y-5" onSubmit={e=>void submit(e)}>
        <fieldset disabled={saving} className="space-y-5">
          <label className="field-label">{de.editor.taskName}<input aria-label={de.editor.taskName} ref={input} readOnly={!editable} required maxLength={200} className="field-input" value={patch.title??''} onChange={e=>change({...patch,title:e.target.value})}/></label>
          <label className="field-label">{de.editor.description}<textarea aria-label={de.editor.description} readOnly={!editable} maxLength={20000} className="field-input whitespace-pre-wrap" rows={5} value={patch.description??''} onChange={e=>change({...patch,description:e.target.value})}/></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field-label">{de.editor.status}<select aria-label={de.editor.status} disabled={!isDemoMode&&editing} className="field-input" value={patch.status} onChange={e=>change({...patch,status:e.target.value as TaskStatus})}>{Object.entries(de.taskStatus).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field-label">{de.editor.priority}<select aria-label={de.editor.priority} disabled={!editable} className="field-input" value={patch.priority} onChange={e=>change({...patch,priority:e.target.value as TaskPriority})}>{Object.entries(de.taskPriority).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field-label">{de.v2.board.assignee}{!isDemoMode&&editing?<input aria-label={de.v2.board.assignee} className="field-input" aria-describedby="task-assignee-hint" pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" value={patch.assigneeId??''} onChange={e=>change({...patch,assigneeId:e.target.value||undefined})}/>:<select aria-label={de.v2.board.assignee} disabled={!isDemoMode} className="field-input" value={patch.assigneeId??''} onChange={e=>change({...patch,assigneeId:e.target.value||undefined})}><option value="">{de.v2.board.unassigned}</option>{task.assigneeId&&!members.some(m=>m.id===task.assigneeId)&&<option value={task.assigneeId}>{task.assigneeId}</option>}{members.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select>}</label>
            <label className="field-label">{de.editor.date}<input aria-label={de.editor.date} disabled={!editable} type="date" className="field-input" value={patch.dueDate??''} onChange={e=>change({...patch,dueDate:e.target.value||undefined})}/></label>
          </div>
          {!isDemoMode&&editing&&<><p className="text-xs text-slate-500">{taskEditing.separateStatus}</p><p id="task-assignee-hint" className="text-xs text-slate-500">{taskEditing.assigneeHint}</p></>}
          <fieldset><legend className="field-label mb-2">{de.v2.board.dependent}</legend><div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-4">{tasks.filter(t=>t.id!==task.id).map(t=><label className="flex gap-2 text-sm" key={t.id}><input disabled={!isDemoMode} type="checkbox" checked={(patch.dependsOn??[]).includes(t.id)} onChange={e=>change({...patch,dependsOn:e.target.checked?[...(patch.dependsOn??[]),t.id]:(patch.dependsOn??[]).filter(id=>id!==t.id)})}/><span>{t.title}</span></label>)}</div>{!isDemoMode&&<p className="mt-2 text-xs text-slate-500">{taskEditing.dependencies}</p>}</fieldset>
        </fieldset>
        {error&&<ErrorState text={error}/>}
        <div className="flex flex-wrap justify-end gap-3 border-t pt-5">
          <button type="button" className="btn-secondary" disabled={saving} onClick={()=>{if(!isDemoMode&&editing){setPatch(original());setEditing(false);setSaved(null);setSavedSignature('');setError(null);}else onClose();}}>{!isDemoMode&&editing?taskEditing.cancelEdit:de.common.cancel}</button>
          <button className="btn-primary" type="submit" disabled={saving||(!isDemoMode&&(editing?(!dirty||signature===savedSignature):!statusChanged))}>{saving?taskEditing.saving:isDemoMode?de.v2.board.save:editing?taskEditing.save:g4.taskSave}</button>
        </div>
      </form>
    </div>
  </div>;
}
