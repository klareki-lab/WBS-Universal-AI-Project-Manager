import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {api,type Plan,type Operation} from '../live/client';
import {type ReadOptions,isAbort} from '../live/readCoordinator';
import {useReadResource} from '../utils/useReadResource';
import {explainError} from '../api/errors';
import {g4} from '../i18n/g4';
import {Card,PageHeader,StatusBadge,ErrorState} from '../components/UI';
type History=Awaited<ReturnType<typeof api.approvalHistory>>;
const emptyHistory:History={items:[],revocations:[]};
export default function LivePlanWorkspace(){
 const {projectId=''}=useParams();
 const [selected,setSelected]=useState('');
 const [prompt,setPrompt]=useState(''),[title,setTitle]=useState(''),[comment,setComment]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const submitting=useRef(false),currentProject=useRef(projectId);currentProject.current=projectId;
 const load=useCallback(async(options:ReadOptions)=>{const [project,plans,jobs]=await Promise.all([api.project(projectId,options),api.plans(projectId,options),api.operations(projectId,{...options,fresh:false})]);return {project,plans:plans.items.slice().sort((a,b)=>b.number-a.number),jobs:jobs.items}},[projectId]);
 const read=useReadResource('plan-workspace:'+projectId,load),{reload}=read;
 const project=read.data?.project,plans=read.data?.plans??[];
 const [polled,setPolled]=useState<{projectId:string;jobs:Operation[]}>({projectId,jobs:[]});
 const jobs=polled.projectId===projectId&&polled.jobs.length?polled.jobs:read.data?.jobs??[];
 const plan:Plan|undefined=plans.find(p=>p.id===selected)??plans[0];
 const historyLoader=useCallback((options:ReadOptions)=>plan?api.approvalHistory(projectId,plan.id,options):Promise.resolve(emptyHistory),[projectId,plan?.id,plan?.status]);
 const historyRead=useReadResource('approvals:'+projectId+':'+(plan?.id??'')+':'+(plan?.status??''),historyLoader);
 const history=historyRead.data??emptyHistory,revoked=history.revocations.length>0;
 useEffect(()=>{setSelected('');setPrompt('');setTitle('');setComment('');setNotice('');setError('');setConfirmed(false);setPolled({projectId,jobs:[]});},[projectId]);
 useEffect(()=>{if(read.data)setPolled({projectId,jobs:read.data.jobs});},[projectId,read.data]);
 useEffect(()=>setConfirmed(false),[projectId,plan?.id,plan?.content_hash,plan?.status]);
 const activeIds=jobs.filter(j=>j.status==='queued'||j.status==='running').map(j=>j.id).sort().join(',');
 useEffect(()=>{
   if(!activeIds)return;
   const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
   // One project-scoped GET while non-terminal IDs exist; no fan-out per job and no idle workspace polling.
   const poll=async()=>{
     try{if(document.visibilityState!=='hidden'){
       const changed=(await api.operations(projectId,{signal:controller.signal,fresh:true})).items;
       if(controller.signal.aborted)return;
       setPolled({projectId,jobs:changed});
       if(changed.some(j=>activeIds.split(',').includes(j.id)&&(j.status==='succeeded'||j.status==='failed')))await reload();
     }}catch(e){if(!isAbort(e)&&!controller.signal.aborted)setError(explainError(e));}
     finally{if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),5000);}
   };
   timer=setTimeout(()=>void poll(),5000);
   return()=>{controller.abort();clearTimeout(timer);};
 },[projectId,activeIds,reload]);
 async function act(fn:()=>Promise<unknown>,message:string){
   if(submitting.current)return;submitting.current=true;setBusy(true);setError('');setNotice('');const pid=projectId;
   try{await fn();if(currentProject.current!==pid)return;setNotice(message);await reload();await historyRead.reload();}
   catch(e){if(currentProject.current===pid)setError(explainError(e));}
   finally{submitting.current=false;setBusy(false);}
 }
 async function draft(){if(!project)return;const snapshot=plan?structuredClone(plan.snapshot):{phases:[{key:'planung',name:'Planung',description:''}],tasks:[]};if(title.trim()){if(snapshot.tasks.length)snapshot.tasks[0].title=title;else snapshot.tasks.push({key:'aufgabe-1',phase_key:'planung',title,description:'',priority:'medium',depends_on:[],due_date:null,assignee_id:null})}const next=await api.createPlan(projectId,project.version,snapshot);if(currentProject.current===projectId){setSelected(next.id);setTitle('')}}
 return <><PageHeader kicker="PLAN-WORKSPACE" title={project?.name??'Projekt laden …'} subtitle="Unveränderliche Planversionen · Menschen entscheiden" action={<Link className="btn-secondary" to={`/projects/${projectId}/board`}>Zum Kanban</Link>}/>
 {Boolean(error||read.error||historyRead.error)&&<ErrorState text={error||explainError(read.error||historyRead.error)} retry={()=>void reload()}/>} {notice&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4">{notice}</p>}
 <div className="grid gap-5 xl:grid-cols-2"><div className="space-y-5"><Card className="p-6"><h2 className="text-lg font-bold">AI-Planung anfordern</h2><p className="my-3 text-sm text-slate-500">Eine Modellantwort ist keine menschliche Freigabe. {g4.aiLanguage}</p><label className="field-label">Planungsziel<textarea className="field-input" value={prompt} onChange={e=>setPrompt(e.target.value)}/></label><button className="btn-primary mt-3" disabled={busy||!prompt.trim()} onClick={()=>void act(()=>api.planning(projectId,prompt),g4.planningSubmitted)}>Planung anfordern</button><ul className="mt-4 text-sm">{jobs.map(j=><li key={j.id}>{j.kind==='publish'?'Veröffentlichung':'Planung'}: <StatusBadge status={j.status}/> {j.error??''}<span className="block font-mono text-xs">{j.id}</span></li>)}</ul></Card>
 <Card className="p-6"><h2 className="font-bold">Entwurf / Revision erstellen</h2><p className="my-3 text-sm">Eine Revision kopiert den gewählten Snapshot und ändert den Titel der ersten Aufgabe. Frühere Versionen bleiben erhalten.</p><label className="field-label">Aufgabentitel<input className="field-input" value={title} onChange={e=>setTitle(e.target.value)}/></label><button className="btn-secondary mt-3" disabled={busy||!project||(!plan&&!title.trim())} onClick={()=>void act(draft,'Neue unveränderliche Entwurfsversion erstellt.')}>Neue Entwurfsversion</button></Card>
 <Card className="p-6"><h2 className="font-bold">Versionshistorie</h2>{plans.map(p=><button key={p.id} onClick={()=>setSelected(p.id)} className="my-2 block w-full rounded-lg border p-3 text-left" aria-pressed={plan?.id===p.id}>v{p.number} · <StatusBadge status={p.status}/><span className="block font-mono text-xs">{p.id}</span></button>)}</Card></div>
 <div className="space-y-5"><Card className="p-6">{plan?<><div className="flex justify-between"><h2 className="text-lg font-bold">Fixierter Snapshot v{plan.number}</h2><StatusBadge status={plan.status}/></div><p className="mt-3 break-all font-mono text-xs" data-testid="plan-version-id">{plan.id}</p><p className="mt-2 break-all font-mono text-xs" data-testid="plan-hash">SHA-256: {plan.content_hash}</p><ul className="my-5 space-y-3">{plan.snapshot.tasks.map(t=><li key={t.key} className="rounded-xl bg-slate-50 p-3"><strong>{t.title}</strong><p className="text-sm">{t.description}</p></li>)}</ul>
 {plan.status==='draft'&&<button className="btn-primary" disabled={busy} onClick={()=>void act(()=>api.review(projectId,plan.id),'Zur Prüfung eingereicht.')}>Review einreichen</button>}
 {plan.status==='in_review'&&<><label className="field-label">Kommentar<textarea className="field-input" value={comment} onChange={e=>setComment(e.target.value)}/></label><label className="my-4 flex gap-3"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Ich genehmige ausdrücklich diese exakte Version und den oben angezeigten Hash.</span></label><div className="flex gap-3"><button className="btn-primary" disabled={busy||!confirmed} onClick={()=>void act(()=>api.decision(projectId,plan,'approved',comment),'Version menschlich freigegeben.')}>Version freigeben</button><button className="btn-secondary" disabled={busy} onClick={()=>void act(()=>api.decision(projectId,plan,'rejected',comment),'Version abgelehnt.')}>Version ablehnen</button></div></>}
 {plan.status==='approved'&&<div className="flex gap-3"><button className="btn-primary" disabled={busy||revoked} onClick={()=>void act(async()=>{const result=await api.publish(projectId,plan);if(result.status!=='succeeded')throw new Error('Veröffentlichung noch nicht bestätigt: '+result.id+' / '+result.status);},'Plan veröffentlicht. Aufgaben sind im Kanban gespeichert.')}>Plan veröffentlichen</button><button className="btn-secondary" disabled={busy} onClick={()=>void act(()=>api.revoke(projectId,plan.id,comment||'Menschlicher Widerruf'),'Freigabe dauerhaft widerrufen.')}>Freigabe widerrufen</button></div>}</>:<p>Noch kein Plan. Planung anfordern oder Entwurf erstellen.</p>}</Card>
 <Card className="p-6"><h2 className="font-bold">Freigabehistorie</h2>{history.items.map(a=><p className="mt-3 rounded-lg border p-3 text-sm" key={a.id}><StatusBadge status={a.decision}/> · {a.created_at}<span className="block font-mono text-xs">{a.plan_version_id}</span>{history.revocations.filter(r=>r.approval_id===a.id).map((r,i)=><strong key={i} className="block text-red-700">Widerrufen: {r.reason} ({r.source})</strong>)}</p>)}</Card></div></div></>;
}
