import {ErrorMessage} from './UI';
import {useId,useMemo,useState,type KeyboardEvent} from 'react';
import type {User} from '../api/types';
import {taskEditing} from '../i18n/taskEditing';

interface Props {
 members:User[]; selectedId?:string; onSelect:(id?:string)=>void;
 loaded:boolean; loading:boolean; error?:string|null; onRetry?:()=>void; disabled:boolean;
}
/** Only G6 directory records are shown; no synthetic suggestions or silent fallback. */
export function ProjectMemberPicker({members,selectedId,onSelect,loaded,loading,error,onRetry,disabled}:Props){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[highlight,setHighlight]=useState(0);
 const id=useId();
 const eligible=useMemo(()=>members.filter(m=>m.kind==='human'&&!m.disabled),[members]);
 const chosen=members.find(m=>m.id===selectedId);
 const matches=eligible.filter(m=>((m.displayName+' '+(m.email??'')).toLocaleLowerCase()).includes(query.toLocaleLowerCase())).slice(0,50);
 const active=matches[Math.min(highlight,Math.max(0,matches.length-1))];
 const blocked=disabled||!loaded||Boolean(error);
 const select=(next?:string)=>{onSelect(next);setQuery('');setOpen(false);setHighlight(0);};
 const key=(e:KeyboardEvent<HTMLInputElement>)=>{
  if(e.key==='Escape'){setOpen(false);return;}
  if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setHighlight(i=>Math.min(i+1,Math.max(0,matches.length-1)));}
  if(e.key==='ArrowUp'){e.preventDefault();setOpen(true);setHighlight(i=>Math.max(0,i-1));}
  if(e.key==='Enter'&&open){e.preventDefault();if(active)select(active.id);}
 };
 return <div className="space-y-2">
  <label className="field-label" htmlFor={id}>{taskEditing.memberLabel}</label>
  {selectedId&&<div data-testid="selected-member" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
   <div><strong>{chosen?chosen.displayName:taskEditing.revokedMember}</strong>
    {chosen?.email&&<span className="ml-2 break-all text-xs text-slate-600">{chosen.email}</span>}
    {(chosen?.disabled||chosen?.kind==='service')&&<p className="text-amber-800">{taskEditing.inactiveMember}</p>}
    {loaded&&!chosen&&<p className="text-amber-800">{taskEditing.memberNotFound}</p>}
   </div>
   <button type="button" className="btn-secondary" onClick={()=>select(undefined)} disabled={disabled} aria-label={taskEditing.clearMember}>{taskEditing.clearMember}</button>
  </div>}
  <input id={id} className="field-input" type="search" autoComplete="off" role="combobox"
    aria-autocomplete="list" aria-expanded={open&&!blocked}
    aria-controls={id+'-list'} aria-activedescendant={open&&active?id+'-'+active.id:undefined}
    placeholder={taskEditing.memberSearchPlaceholder} value={query} disabled={blocked}
    onChange={e=>{setQuery(e.target.value);setHighlight(0);setOpen(true)}}
    onFocus={()=>setOpen(true)} onKeyDown={key} onBlur={()=>setTimeout(()=>setOpen(false),120)} />
  {loading&&!loaded&&<p role="status" className="text-xs text-slate-500">{taskEditing.membersLoading}</p>}
  {error&&<div role="alert" className="text-sm text-red-700">{taskEditing.membersUnavailable} <ErrorMessage text={error}/>
    {onRetry&&<button type="button" className="ml-2 underline" onClick={onRetry}>{taskEditing.membersRetry}</button>}</div>}
  {loaded&&!error&&!eligible.length&&<p className="text-sm text-amber-800">{taskEditing.membersEmpty}</p>}
  {loaded&&!error&&open&&!blocked&&<ul id={id+'-list'} role="listbox" aria-label={taskEditing.memberResults} className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
   {matches.map((m,i)=><li key={m.id} role="option" id={id+'-'+m.id} aria-selected={selectedId===m.id}>
    <button type="button" className={'w-full rounded-lg px-3 py-2 text-left text-sm '+(i===highlight?'bg-emerald-50':'hover:bg-slate-50')}
     onMouseDown={e=>e.preventDefault()} onClick={()=>select(m.id)}>
     <span className="font-semibold">{m.displayName}</span><span className="ml-2 break-all text-xs text-slate-500">{m.email??''}</span>
     <span className="block text-xs text-slate-500">{m.role}</span>
    </button></li>)}
   {!matches.length&&<li className="p-3 text-sm text-slate-500">{taskEditing.membersNoMatches}</li>}
   {matches.length===50&&<li className="p-2 text-xs text-slate-500">{taskEditing.refineSearch}</li>}
  </ul>}
 </div>;
}
