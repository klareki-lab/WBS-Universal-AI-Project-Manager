import {ErrorMessage} from './UI';
import {useMemo,useState} from 'react';
import type {Task} from '../api/types';
import {taskEditing} from '../i18n/taskEditing';

interface Props {
 taskId:string; projectId?:string; tasks:Task[]; selected:string[];
 onChange:(ids:string[])=>void; disabled:boolean; loading:boolean;
 error?:string|null; onRetry?:()=>void;
}
export function TaskDependencyPicker({taskId,projectId,tasks,selected,onChange,disabled,loading,error,onRetry}:Props){
 const [query,setQuery]=useState('');
 const choices=useMemo(()=>tasks.filter(t=>t.id!==taskId&&(!t.projectId||t.projectId===projectId)),[tasks,taskId,projectId]);
 const byId=new Map(choices.map(t=>[t.id,t]));
 const candidates=choices.filter(t=>t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,50);
 const toggle=(id:string,on:boolean)=>{
  if(id===taskId||!byId.has(id))return;
  onChange(on?[...new Set([...selected,id])]:selected.filter(x=>x!==id));
 };
 return <fieldset className="space-y-3">
  <legend className="field-label">{taskEditing.depLabel}</legend>
  <p className="text-xs text-slate-500">{taskEditing.depHelp}</p>
  {loading&&<p role="status" className="text-xs">{taskEditing.depsLoading}</p>}
  {error&&<div role="alert" className="text-sm text-red-700">{taskEditing.depsUnavailable} <ErrorMessage text={error}/>
    {onRetry&&<button type="button" className="ml-2 underline" onClick={onRetry}>{taskEditing.membersRetry}</button>}</div>}
  <ul aria-label={taskEditing.currentDeps} className="space-y-1">
   {selected.map(id=><li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
    <span>{byId.get(id)?.title??taskEditing.unknownDependency}{!byId.has(id)&&<details className="text-xs"><summary>Technische Details</summary><span className="break-all">{id}</span></details>}</span>
    <button type="button" className="text-emerald-800 underline disabled:text-slate-400"
     aria-label={taskEditing.removeDependency(byId.get(id)?.title??taskEditing.unknownDependency)}
     disabled={disabled||Boolean(error)} onClick={()=>onChange(selected.filter(x=>x!==id))}>{taskEditing.remove}</button>
   </li>)}
   {!selected.length&&!loading&&!error&&<li className="text-sm text-slate-500">{taskEditing.noDependencies}</li>}
  </ul>
  <label className="field-label">{taskEditing.depSearch}
   <input className="field-input" type="search" disabled={disabled||Boolean(error)}
    value={query} onChange={e=>setQuery(e.target.value)} placeholder={taskEditing.depSearchPlaceholder} />
  </label>
  <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
   {candidates.map(t=><label className="flex cursor-pointer items-start gap-2 text-sm" key={t.id}>
    <input type="checkbox" className="mt-1" aria-label={taskEditing.dependencyOption(t.title)}
     disabled={disabled||Boolean(error)} checked={selected.includes(t.id)} onChange={e=>toggle(t.id,e.target.checked)}/>
    <span>{t.title}</span>
   </label>)}
   {!candidates.length&&<p className="text-sm text-slate-500">{taskEditing.noDependencyMatches}</p>}
   {candidates.length===50&&<p className="text-xs text-slate-500">{taskEditing.refineSearch}</p>}
  </div>
 </fieldset>;
}
