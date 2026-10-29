import {useCallback,useState} from 'react';
import {useParams} from 'react-router-dom';
import {api,session,type Employee,type Page,type ProjectMember} from '../live/client';
import type {ReadOptions} from '../live/readCoordinator';
import {useReadResource} from '../utils/useReadResource';
import {explainError} from '../api/errors';
import {Card,EmptyState,ErrorState,Loading,PageHeader} from '../components/UI';
import {isDemoMode} from '../api';

async function allPages<T>(load:(offset:number)=>Promise<Page<T>>):Promise<T[]>{
 const items:T[]=[];
 for(let offset=0;offset<=100000;offset+=100){const page=await load(offset);if(!Array.isArray(page.items)||page.offset!==offset||page.items.length>100)throw new Error('Das Verzeichnis konnte nicht vollständig geladen werden.');items.push(...page.items);if(page.items.length<100)return items;}
 throw new Error('Das Verzeichnis ist zu groß.');
}
const roleLabel=(role:string)=>role==='owner'?'Projektleitung':role==='editor'?'Bearbeiten':role==='viewer'?'Ansehen':'Dienstkonto';
export default function ProjectTeam(){
 const {projectId=''}=useParams();const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async(options:ReadOptions)=>{
  const [project,user,members]=await Promise.all([api.project(projectId,options),session(options),allPages<ProjectMember>(o=>api.members(projectId,options,o))]);
  const owner=project.owner_id===user.id;let employees:Employee[]=[];let directoryError:unknown=null;
  if(owner){try{employees=await allPages<Employee>(o=>api.employees(projectId,options,o));}catch(e){directoryError=e;}}
  return {project,members,owner,employees,directoryError};
 },[projectId]);
 const read=useReadResource('team:'+projectId,load);
 const act=async(fn:()=>Promise<unknown>,message:string)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();await read.reload();setNotice(message);}catch(e){setError(explainError(e));}finally{setBusy(false);}};
 if(isDemoMode)return <><PageHeader kicker="PROJEKT" title="Projektteam" subtitle="Mitglieder und Zuständigkeiten"/><EmptyState text="Die Teamverwaltung ist in der Demo nicht verfügbar."/></>;
 if(read.loading&&!read.data)return <Loading/>;if(read.error||!read.data)return <ErrorState text={explainError(read.error)} retry={()=>void read.reload()}/>;
 const {project,members,owner,employees,directoryError}=read.data;
 const available=employees.filter(e=>!members.some(m=>m.user_id===e.user_id)&&`${e.display_name} ${e.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <><PageHeader kicker="PROJEKT" title="Projektteam" subtitle={`${project.name} · Personen und Rollen im Projekt`}/>
 {error&&<ErrorState text={error}/>} {notice&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4">{notice}</p>}
 <div className="grid gap-5 xl:grid-cols-2"><Card className="p-6"><h2 className="text-lg font-bold">Projektmitglieder</h2><p className="my-3 text-sm text-slate-500">{owner?'Du kannst Rollen ändern und Mitglieder entfernen.':'Die Projektleitung verwaltet die Mitglieder.'}</p>
 <ul className="space-y-3">{members.filter(m=>m.kind==='human').map(m=><li key={m.user_id} className="rounded-xl border p-4"><p className="font-semibold">{m.display_name}</p><p className="text-sm text-slate-500">{m.email}</p><div className="mt-3 flex flex-wrap items-center gap-3">{owner&&m.role!=='owner'?<><label className="text-sm">Rolle <select aria-label={`Rolle für ${m.display_name}`} value={m.role} disabled={busy} className="rounded border p-1" onChange={e=>void act(()=>api.setMember(projectId,m.user_id,e.target.value as 'editor'|'viewer'),'Rolle gespeichert.')}><option value="editor">Bearbeiten</option><option value="viewer">Ansehen</option></select></label><button disabled={busy} className="text-sm text-red-700 underline" onClick={()=>void act(()=>api.removeMember(projectId,m.user_id),'Mitglied entfernt.')}>Entfernen</button></>:<span className="text-sm">{roleLabel(m.role)}</span>}{m.disabled&&<span className="text-sm text-amber-700">Konto deaktiviert</span>}</div></li>)}</ul></Card>
 {owner&&<Card className="p-6"><h2 className="text-lg font-bold">Mitarbeitende hinzufügen</h2>{directoryError?<><ErrorState text={explainError(directoryError)} retry={()=>void read.reload()}/>{typeof directoryError==='object'&&directoryError!==null&&'code' in directoryError&&directoryError.code==='company_not_configured'&&<button className="btn-secondary mt-3" disabled={busy} onClick={()=>void act(()=>api.attachCompany(projectId),'Unternehmensverzeichnis verbunden.')}>Unternehmensverzeichnis verbinden</button>}</>:<><label className="field-label mt-4">Name oder E-Mail suchen<input type="search" className="field-input" value={query} onChange={e=>setQuery(e.target.value)}/></label><ul className="mt-4 space-y-3">{available.map(e=><li key={e.user_id} className="rounded-xl border p-4"><p className="font-semibold">{e.display_name}</p><p className="text-sm text-slate-500">{e.email}</p><button disabled={busy} className="btn-secondary mt-3" onClick={()=>void act(()=>api.setMember(projectId,e.user_id,'viewer'),'Mitglied hinzugefügt. Die Rolle kann geändert werden.')}>Zum Projekt hinzufügen</button></li>)}</ul>{!available.length&&<p className="mt-4 text-sm text-slate-500">Keine weiteren passenden Mitarbeitenden.</p>}</>}</Card>}</div></>;
}
