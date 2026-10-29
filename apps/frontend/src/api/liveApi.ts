import type {ReadOptions} from '../live/readCoordinator';
import {activityNames} from '../i18n/g4';
import type {ProjectApi,Project,PlanVersion,Task,NewProjectInput,OperationalTaskPatch,TaskEdit,TaskStatus,Approval,ActivityEvent,OperationJob,AppCapabilities} from './types';
import {api,activeSession,login,logout,session,type Plan,type Project as ServerProject,type Task as ServerTask,type Page,type ProjectMember as ServerMember} from '../live/client';
/**
 * The G6 collection contract is offset/limit based (100 maximum).
 * A full directory is necessary to avoid treating users on later pages as revoked.
 * Never silently substitute an incomplete result.
 */
async function allPages<T>(load:(offset:number)=>Promise<Page<T>>,options:ReadOptions={}):Promise<T[]> {
 const items:T[]=[];const pageSize=100;
 for(let offset=0;offset<=100000;offset+=pageSize){
  if(options.signal?.aborted)throw new DOMException('Leseanfrage abgebrochen','AbortError');
  const page=await load(offset);
  if(!page||!Array.isArray(page.items)||page.items.length>pageSize||page.offset!==offset)
    throw new Error('Unvollständige paginierte Backend-Antwort. Daten nicht übernommen.');
  items.push(...page.items);
  if(page.items.length<pageSize)return items;
 }
 throw new Error('Mitglieder- oder Aufgabenverzeichnis überschreitet den erlaubten Bereich. Keine Teildaten übernommen.');
}
const member=(m:ServerMember):User=>({id:m.user_id,displayName:m.display_name,email:m.email,kind:m.kind,role:m.role,disabled:m.disabled});
const unsupported=(name:string):never=>{throw new Error(name+' wird von der aktuellen Backend-API noch nicht unterstützt. Keine Änderung wurde gespeichert.')};
const mp=(p:ServerProject):Project=>({id:p.id,name:p.name,description:p.description,type:'custom',targetDate:'',constraints:[],status:p.status,progress:0,createdAt:p.created_at,approvedPlanVersionId:p.published_plan_id??undefined});
const mt=(t:ServerTask):Task=>({id:t.id,projectId:t.project_id,phaseId:t.phase_id,title:t.title,description:t.description,status:t.status,priority:t.priority,estimateDays:0,dueDate:t.due_date??undefined,dependsOn:[],assigneeId:t.assignee_id??undefined,updatedAt:undefined,version:t.version});
const mplan=(p:Plan):PlanVersion=>({id:p.id,projectId:p.project_id,version:p.number,status:p.status,createdAt:p.created_at,source:'proposal',warnings:[],phases:p.snapshot.phases.map((x,i)=>({id:x.key,title:x.name,description:x.description,order:i})),tasks:p.snapshot.tasks.map(x=>({id:x.key,phaseId:x.phase_key,title:x.title,description:x.description,status:'todo',priority:x.priority,estimateDays:0,dueDate:x.due_date??undefined,dependsOn:x.depends_on,assigneeId:x.assignee_id??undefined}))});
const op=(x:{id:string;project_id:string;status:string;created_at:string;kind:string;error:string|null}):OperationJob=>({id:x.id,projectId:x.project_id,type:x.kind==='publish'?'plan-publication':'plan-analysis',state:x.status as OperationJob['state'],createdAt:x.created_at,retrySafe:false,retryReason:'Unbekannter Ausgang: nicht automatisch erneut ausführen',simulated:false,detail:x.error??(x.kind==='publish'?'Planveröffentlichung':'Planungsauftrag')});
export const liveApi:ProjectApi={
 async listProjects(options){return (await api.projects(options)).items.map(mp)},
 async getProject(id,options){return mp(await api.project(id,options))},
 async createProject(input:NewProjectInput){if(input.budget||input.targetDate||input.constraints.length)unsupported('Budget, Frist oder Projektbedingungen');const p=await api.createProject(input.name,input.description);return {project:mp(p),plan:{id:'',projectId:p.id,version:0,status:'draft',createdAt:p.created_at,source:'proposal',phases:[],tasks:[],warnings:[]}}},
 async listTasks(id,options){const tasks=await allPages(offset=>api.tasks(id,options,offset),options);return tasks.map(mt)},
 async updateTask(pid,tid,patch:OperationalTaskPatch,expectedVersion){const keys=Object.keys(patch);if(keys.length!==1||!('status'in patch)||!patch.status)unsupported('Direkte Metadatenänderung');if(!Number.isInteger(expectedVersion)||!expectedVersion)throw new Error('Aufgabenversion fehlt. Bitte Aufgabe erneut laden.');return mt(await api.status(pid,{id:tid,version:expectedVersion},patch.status as TaskStatus))},
 async createTask(){return unsupported('Aufgabe ohne veröffentlichten Plan erstellen')},
 async listMembers(pid,options){
  const rows=await allPages(offset=>api.members(pid,options,offset),options);
  const unique=new Map<string,User>();
  for(const m of rows){
    if(!m||typeof m.user_id!=='string'||typeof m.display_name!=='string'||typeof m.disabled!=='boolean'
      ||!['human','service'].includes(m.kind)||!['owner','editor','viewer'].includes(m.role))
      throw new Error('Ungültige Mitgliederdaten vom Backend. Keine Demo-Nutzer eingesetzt.');
    unique.set(m.user_id,member(m));
  }
  return [...unique.values()];
 },
 async getPlan(vid){return unsupported('Plan ohne Projekt-ID abrufen: '+vid)},
 async listPlans(pid,options){return (await api.plans(pid,options)).items.map(mplan)},
 async createDraftFromApproved(){return unsupported('Entwurf aus genehmigtem Plan erstellen')},
 async reviseTask(_p:string,_v:string,_t:string,_edit:TaskEdit){return unsupported('Planaufgabe bearbeiten')},
 async addTaskFromDescription(){return unsupported('Neue Planaufgabe')},
 async demoPlanningReply(){return unsupported('Demoantwort im Live-Modus')},
 async diffPlan(pid,vid,options){const plans=(await api.plans(pid,options)).items;const current=plans.find(p=>p.id===vid);if(!current)throw new Error('Plan nicht gefunden');const base=plans.filter(p=>p.status==='published').sort((a,b)=>b.number-a.number)[0];const previous=new Map((base?.snapshot.tasks??[]).map(t=>[t.key,t]));const next=new Map(current.snapshot.tasks.map(t=>[t.key,t]));const changes:Array<{taskId:string;action:'added'|'modified'|'removed';before?:Task;after?:Task}>=[];for(const [key,t] of next){const old=previous.get(key);if(!old||JSON.stringify(old)!==JSON.stringify(t))changes.push({taskId:key,action:old?'modified':'added',before:old?mt({id:key,project_id:pid,phase_id:old.phase_key,status:'todo',version:1,...old} as unknown as ServerTask):undefined,after:mt({id:key,project_id:pid,phase_id:t.phase_key,status:'todo',version:1,...t} as unknown as ServerTask)})}for(const [key,t] of previous)if(!next.has(key))changes.push({taskId:key,action:'removed',before:mt({id:key,project_id:pid,phase_id:t.phase_key,status:'todo',version:1,...t} as unknown as ServerTask)});return {projectId:pid,baseVersionId:base?.id,candidateVersionId:vid,changes}},
 async approveVersion(pid,vid){const plan=await api.plan(pid,vid);if(plan.status==='draft')await api.review(pid,vid);await api.decision(pid,plan,'approved','');return {id:crypto.randomUUID(),projectId:pid,planVersionId:vid,approvedAt:new Date().toISOString(),approvedByLabel:'Angemeldeter Benutzer',simulated:false} as Approval},
 async rejectVersion(pid,vid,reason){const p=await api.plan(pid,vid);if(p.status==='draft')await api.review(pid,vid);await api.decision(pid,p,'rejected',reason)},
 async requestRevision(){return unsupported('Überarbeitung anfordern')},
 async listApprovals(){return []},
 async assistantMessage(pid,text,intent){if(intent!=='propose')unsupported('Konversation ohne Agent-Planung');const result=await api.planning(pid,text);return {id:result.id,role:'assistant',text:'Planungsoperation: '+result.id+' ('+result.status+'). Im Aktivitätsbereich prüfen.',kind:'proposal',createdAt:result.created_at,simulated:false as never}},
 async listConversation(pid,options){const jobs=(await api.operations(pid,options)).items.filter(o=>o.kind==='planning');return {id:pid,projectId:pid,createdAt:new Date(0).toISOString(),messages:jobs.map(o=>({id:o.id,role:'assistant' as const,text:'Planungsoperation '+o.id+': '+({queued:'Wartend',running:'In Bearbeitung',succeeded:'Erfolgreich',failed:'Fehlgeschlagen'}[o.status])+(o.error?' · '+o.error:''),kind:'proposal' as const,createdAt:o.created_at,simulated:false}))}},
 async listProposals(){return []},
 async applyProposal(){return unsupported('AI-Vorschlag direkt anwenden')},
 async rejectProposal(){return unsupported('Vorschlag direkt verwerfen')},
 async listOperations(pid,options){if(!pid)return [];return (await api.operations(pid,options)).items.map(op)},
 async listActivity(pid,options){if(!pid)return [];return (await api.activity(pid,options)).items.map(e=>({id:e.id,projectId:pid,at:e.created_at,category:'operation',title:activityNames[String(e.type)]??'Backend-Ereignis',detail:String(e.type)+' / '+e.id,level:'info',simulated:false} as ActivityEvent))},
 async getCapabilities(){return {mode:'live',persistence:true,aiAvailable:true,integrations:[]} as AppCapabilities}
};
export const auth={login,logout,session,activeSession};