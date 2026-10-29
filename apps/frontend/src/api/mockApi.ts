import { ApiError } from './errors';
import { computePlanChanges, validateDependencies } from '../domain/plans';
import type { ActivityEvent, AgentConversation, AgentMessage, Approval, ChangeProposal, NewProjectInput, OperationJob, OperationalTaskPatch, Phase, PlanVersion, Project, ProjectApi, ProjectType, Task, TaskEdit, User } from './types';

const clone = <T>(x: T): T => structuredClone(x);
const sleep = (ms = 45) => new Promise<void>(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const inDays = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10); };
let sequence = 700;
const uid = (kind: string) => `${kind}-${++sequence}`;
const names: Record<ProjectType, string[]> = {
  it: ['Analyse', 'Design', 'Implementierung', 'Qualität'], marketing: ['Zielgruppe', 'Konzept', 'Produktion', 'Auswertung'],
  operations: ['Ist-Prozess', 'Soll-Prozess', 'Pilot', 'Einführung'], event: ['Planung', 'Partner', 'Durchführung', 'Nachbereitung'],
  custom: ['Ziele', 'Konzept', 'Umsetzung', 'Abnahme'],
};
const templates: Record<ProjectType, string[]> = {
  it: ['Anforderungen und Nutzerbedürfnisse klären', 'Lösungsarchitektur abstimmen', 'Erste Funktion umsetzen', 'Tests und Abnahme durchführen'],
  marketing: ['Zielgruppe und KPIs definieren', 'Kampagnenkonzept erstellen', 'Inhalte und Kanäle vorbereiten', 'Ergebnisse analysieren'],
  operations: ['Bestehenden Ablauf dokumentieren', 'Verbesserten Prozess entwerfen', 'Pilot mit dem Fachteam durchführen', 'Wirkung im Betrieb messen'],
  event: ['Teilnehmerkreis und Ziele klären', 'Programm und Partner abstimmen', 'Organisation abschließen', 'Feedback auswerten'],
  custom: ['Erfolgskriterien vereinbaren', 'Arbeitspakete priorisieren', 'Erste Lösung umsetzen', 'Ergebnisse abnehmen'],
};
let projects: Project[] = [];
let plans: PlanVersion[] = [];
let projectTasks: Record<string, Task[]> = {};
let approvals: Approval[] = [];
let proposals: ChangeProposal[] = [];
let history: ActivityEvent[] = [];
let conversations: Record<string, AgentConversation> = {};
const members: User[] = [{ id: 'u-demo', displayName: 'Demo-Nutzer' }, { id: 'u-alex', displayName: 'Alex Wagner' }, { id: 'u-sam', displayName: 'Sam Becker' }];
const exampleOperations: OperationJob[] = [
  { id:'example-queued', projectId:'p-portal', type:'plan-analysis', state:'queued', createdAt:now(), retrySafe:false, retryReason:'Ein wartender Auftrag darf nicht erneut ausgelöst werden.', simulated:true, detail:'Nur Statusbeispiel; kein Auftrag wurde gestartet.' },
  { id:'example-running', projectId:'p-portal', type:'proposal-validation', state:'running', createdAt:now(), retrySafe:false, retryReason:'Während einer Ausführung nicht erneut starten.', simulated:true, detail:'Nur Statusbeispiel; keine Verarbeitung läuft.' },
  { id:'example-completed', projectId:'p-portal', type:'report-generation', state:'completed', createdAt:now(), retrySafe:false, retryReason:'Abgeschlossener Beispielauftrag, kein Retry erforderlich.', simulated:true, detail:'Nur Statusbeispiel; kein Bericht wurde erstellt.' },
  { id:'example-partial', projectId:'p-campaign', type:'report-generation', state:'partial', createdAt:now(), retrySafe:false, retryReason:'Teilresultate erst abgleichen; Wiederholung könnte Duplikate erzeugen.', simulated:true, detail:'Nur Statusbeispiel; kein Teilresultat existiert.' },
  { id:'example-failed', projectId:'p-ops', type:'plan-analysis', state:'failed', createdAt:now(), retrySafe:true, retryReason:'Im Beispiel ist der Schritt lesend und ohne Nebenwirkungen; Wiederholung wäre sicher.', simulated:true, detail:'Nur Statusbeispiel; es gab keinen echten Fehler.' },
];
function record(projectId: string | undefined, category: ActivityEvent['category'], title: string, detail: string, level: ActivityEvent['level']='info') {
  history.unshift({ id:uid('event'), projectId, category, title, detail, level, at:now(), simulated:true });
}
function requireProject(id: string) { const p = projects.find(x => x.id === id); if (!p) throw new ApiError('NOT_FOUND','Projekt nicht gefunden.',false); return p; }
function requirePlan(id: string) { const p = plans.find(x => x.id === id); if (!p) throw new ApiError('NOT_FOUND','Planversion nicht gefunden.',false); return p; }
function currentDraft(projectId: string, versionId: string) {
  const p = requireProject(projectId), version = requirePlan(versionId);
  if (version.projectId !== projectId || p.activeDraftVersionId !== versionId || version.status !== 'draft') throw new ApiError('CONFLICT','Entwurf ist veraltet. Daten neu laden; nicht blind wiederholen.',false);
  return { p, version };
}
function createTemplate(projectId: string, type: ProjectType, targetDate: string, status: PlanVersion['status'], version: number): PlanVersion {
  const phases: Phase[] = names[type].map((title, order) => ({ id:uid('phase'), title, description:'', order }));
  const tasks: Task[] = templates[type].map((title,i) => ({
    id:uid('task'), phaseId:phases[i].id, projectId, title, description:`Ergebnis festlegen und abstimmen: ${title}.`,
    status:i===0?'in_progress':'todo', priority:i===3?'high':'medium', estimateDays:2+i,
    dueDate:i===3?targetDate:inDays(6+i*9), dependsOn:[], assigneeId:i===0?'u-demo':undefined,
  }));
  tasks.forEach((task,i) => { if(i) task.dependsOn=[tasks[i-1].id]; });
  return { id:uid('plan'), projectId, version, status, source:'demo-template', createdAt:now(), phases, tasks, warnings:[{ id:uid('warning'), severity:'warning', title:'Abhängigkeiten prüfen', detail:'Die Beispieldaten enthalten einfache Reihenfolge-Abhängigkeiten; Termine bitte kontrollieren.' }] };
}
function fork(project: Project, base: PlanVersion, source: PlanVersion['source']): PlanVersion {
  const next: PlanVersion = { ...clone(base), id:uid('plan'), version:Math.max(...plans.filter(p=>p.projectId===project.id).map(p=>p.version))+1, createdAt:now(), source, status:'draft' };
  if (base.status==='draft') base.status='superseded'; // only lifecycle metadata changes
  plans.push(next); project.activeDraftVersionId=next.id;
  return next;
}
function validateTaskEdit(tasks: Task[]) { validateDependencies(tasks); for(const task of tasks) if(!task.title.trim() || task.estimateDays<1) throw new ApiError('VALIDATION','Titel und geschätzter Aufwand müssen gültig sein.',false); }
function progress(projectId: string) { const ts=projectTasks[projectId]??[]; return ts.length ? Math.round(100*ts.filter(t=>t.status==='done').length/ts.length):0; }
function seed() {
  sequence=700; projects=[]; plans=[]; projectTasks={}; approvals=[]; proposals=[]; history=[]; conversations={};
  const entries: Array<[string,string,ProjectType,number,Project['status'],string]> = [
    ['p-portal','Customer Portal Relaunch','it',44,'active','B2B-Portal mit Self-Service und sicherer Datenanbindung modernisieren.'],
    ['p-campaign','DACH Growth Kampagne','marketing',24,'at_risk','Kanalübergreifende Kampagne für hochwertige B2B-Anfragen.'],
    ['p-ops','Service Operations 2.0','operations',68,'active','Serviceabläufe vereinfachen und Übergaben verbessern.'],
  ];
  for (const [id,name,type,days,status,description] of entries) {
    const project: Project={id,name,description,type,targetDate:inDays(days),constraints:[],status,progress:0,createdAt:now()};
    const approved=createTemplate(id,type,project.targetDate,'approved',1);
    project.approvedPlanVersionId=approved.id;
    projects.push(project); plans.push(approved);
    projectTasks[id]=clone(approved.tasks).map((task,i)=>({...task, status:i===0?'done':i===1?'in_progress':i===2&&id==='p-campaign'?'blocked':'todo',assigneeId:i===1?'u-alex':task.assigneeId}));
    project.progress=progress(id);
    if (id==='p-portal') { const next=fork(project,approved,'user-edit'); next.tasks[1].title='Architektur inklusive Datenschutz abstimmen'; next.tasks[1].priority='high'; }
  }
  record('p-portal','plan','Beispielentwurf v2','Änderung gegenüber freigegebenem Plan v1 (lokale Startdaten).');
  record('p-campaign','task','Blockierte Aufgabe (Beispiel)','Kampagneninhalt benötigt eine Rückmeldung aus dem Fachteam.','warning');
}
seed();
/** In-memory, deterministic demonstration only. Page reload resets state. No remote calls. */
export const mockApi: ProjectApi = {
  async listProjects(){await sleep(); return clone(projects.map(p=>({...p,progress:progress(p.id)})));},
  async getProject(id){await sleep(); const p=requireProject(id); return clone({...p,progress:progress(id)});},
  async createProject(input:NewProjectInput){ await sleep();
    if(!input.name.trim()||!input.description.trim()||!input.targetDate)throw new ApiError('VALIDATION','Name, Beschreibung und Zieltermin angeben.',false);
    if(input.budget!==undefined&&(!Number.isFinite(input.budget)||input.budget<0))throw new ApiError('VALIDATION','Ungültiges Budget.',false);
    const project:Project={id:uid('project'),name:input.name.trim(),description:input.description.trim(),type:input.type,targetDate:input.targetDate,budget:input.budget,constraints:clone(input.constraints),status:'planning',progress:0,createdAt:now()};
    const plan=createTemplate(project.id,project.type,project.targetDate,'draft',1);
    project.activeDraftVersionId=plan.id; projects.unshift(project); plans.push(plan); projectTasks[project.id]=[];
    record(project.id,'project','Demoprojekt lokal erstellt','Vorlagenplan erstellt; kein KI-Dienst aufgerufen.','success'); return clone({project,plan});
  },
  async listTasks(projectId){await sleep(); requireProject(projectId); return clone(projectTasks[projectId]??[]);},
  async createTask(projectId,input){await sleep(); const project=requireProject(projectId); if(!input.title.trim())throw new ApiError('VALIDATION','Aufgabentitel erforderlich.',false);
    const task:Task={id:uid('task'),projectId,phaseId:'unassigned',title:input.title.trim(),description:input.description,status:'todo',priority:input.priority,estimateDays:1,dueDate:input.dueDate,dependsOn:[],updatedAt:now()};
    projectTasks[project.id].push(task); project.progress=progress(projectId); record(projectId,'task','Aufgabe lokal angelegt',task.title,'success'); return clone(task);
  },
  async updateTask(projectId,taskId,patch:OperationalTaskPatch){await sleep(); const project=requireProject(projectId); const task=projectTasks[projectId]?.find(t=>t.id===taskId);
    if(!task)throw new ApiError('NOT_FOUND','Aufgabe nicht gefunden.',false);
    if(patch.title!==undefined && !patch.title.trim())throw new ApiError('VALIDATION','Titel darf nicht leer sein.',false);
    if(patch.assigneeId && !members.some(m=>m.id===patch.assigneeId))throw new ApiError('VALIDATION','Unbekannte Person.',false);
    const next={...task,...clone(patch),updatedAt:now()}; validateDependencies(projectTasks[projectId].map(t=>t.id===taskId?next:t));
    Object.assign(task,next); project.progress=progress(projectId); record(projectId,'task','Aufgabe lokal aktualisiert',task.title,'success'); return clone(task);
  },
  async listMembers(projectId){await sleep(); requireProject(projectId); return clone(members);},
  async getPlan(id){await sleep(); return clone(requirePlan(id));},
  async listPlans(projectId){await sleep(); requireProject(projectId); return clone(plans.filter(p=>p.projectId===projectId).sort((a,b)=>b.version-a.version));},
  async createDraftFromApproved(projectId){await sleep(); const p=requireProject(projectId); if(p.activeDraftVersionId)throw new ApiError('CONFLICT','Es existiert bereits ein aktiver Entwurf.',false);
    const source=p.approvedPlanVersionId?requirePlan(p.approvedPlanVersionId):plans.filter(x=>x.projectId===projectId).sort((a,b)=>b.version-a.version)[0];
    if(!source)throw new ApiError('NOT_FOUND','Keine frühere Planversion.',false);
    const draft=fork(p,source,'revision'); record(projectId,'plan','Neue Entwurfsversion lokal erstellt',draft.id); return clone(draft);
  },
  async reviseTask(projectId,versionId,taskId,patch:TaskEdit){await sleep();const {p,version}=currentDraft(projectId,versionId);const original=version.tasks.find(t=>t.id===taskId);
    if(!original)throw new ApiError('NOT_FOUND','Aufgabe nicht gefunden.',false);
    const check=version.tasks.map(t=>t.id===taskId?{...t,...clone(patch)}:t);validateTaskEdit(check);
    const draft=fork(p,version,'user-edit');draft.tasks=check;record(projectId,'plan',`Entwurf v${draft.version} lokal erstellt`, `Aufgabe ${original.title} überarbeitet.`,'success');return clone(draft);
  },
  async addTaskFromDescription(projectId,versionId,description){await sleep();const {p,version}=currentDraft(projectId,versionId);
    if(!description.trim())throw new ApiError('VALIDATION','Beschreibung erforderlich.',false);
    const draft=fork(p,version,'demo-chat');draft.tasks.push({id:uid('task'),projectId,phaseId:draft.phases[0].id,title:description.trim().slice(0,100),description:'Aus Demo-Eingabe übernommen. Inhalt vor Freigabe prüfen.',status:'todo',priority:'medium',estimateDays:2,dependsOn:[]});
    record(projectId,'plan','Aufgabe aus Demo-Text vorgeschlagen',`Neue Entwurfsversion ${draft.id}`);return clone(draft);
  },
  async demoPlanningReply(text){await sleep();if(!text.trim())throw new ApiError('VALIDATION','Nachricht fehlt.',false);return {message:'Lokale Demo-Regel (keine KI): Beschreibe eine Aufgabe und übernimm sie bewusst in einen neuen Entwurf. Termine, Prioritäten und Abhängigkeiten kannst du rechts bearbeiten.',generatedBy:'local-demo-rule'};},
  async diffPlan(projectId,versionId){await sleep();const p=requireProject(projectId),candidate=requirePlan(versionId);if(candidate.projectId!==projectId)throw new ApiError('VALIDATION','Falsches Projekt.',false);
    return {projectId,baseVersionId:p.approvedPlanVersionId,candidateVersionId:versionId,changes:computePlanChanges(p.approvedPlanVersionId?requirePlan(p.approvedPlanVersionId):undefined,candidate)};
  },
  async approveVersion(projectId,versionId){await sleep();const {p,version}=currentDraft(projectId,versionId);validateTaskEdit(version.tasks);
    const prior=p.approvedPlanVersionId?requirePlan(p.approvedPlanVersionId):undefined;
    // Planning fields publish into native tasks; preserve operational status/assignee.
    const existing=new Map((projectTasks[projectId]??[]).map(t=>[t.id,t]));
    for(const task of version.tasks){const live=existing.get(task.id); if(live) existing.set(task.id,{...clone(task),status:live.status,assigneeId:live.assigneeId,updatedAt:now()});else existing.set(task.id,{...clone(task),status:'todo',updatedAt:now()});}
    projectTasks[projectId]=Array.from(existing.values()); // deliberately do not delete removed live tasks until backend policy agreed
    if(prior)prior.status='superseded';version.status='approved';p.approvedPlanVersionId=version.id;p.activeDraftVersionId=undefined;p.status='active';p.progress=progress(projectId);
    const approval:Approval={id:uid('approval'),projectId,planVersionId:version.id,approvedAt:now(),approvedByLabel:'Demo-Nutzer',simulated:true};approvals.unshift(approval);
    record(projectId,'approval',`Plan v${version.version} lokal freigegeben`,`Exakte Snapshot-ID ${version.id}. Keine echte Autorisierungsprüfung.`, 'success');return clone(approval);
  },
  async rejectVersion(projectId,versionId,reason){await sleep();const {p,version}=currentDraft(projectId,versionId);version.status='rejected';p.activeDraftVersionId=undefined;record(projectId,'approval','Entwurf lokal abgelehnt',`Version ${versionId}: ${reason||'ohne Angabe'}`,'warning');},
  async requestRevision(projectId,versionId,note){await sleep();const {p,version}=currentDraft(projectId,versionId);const next=fork(p,version,'revision');next.warnings.push({id:uid('warning'),severity:'info',title:'Überarbeitung angefordert',detail:note.trim()||'Entwurf erneut prüfen.'});record(projectId,'approval',`Überarbeitung für v${next.version} angefordert`,note,'info');return clone(next);},
  async listApprovals(projectId){await sleep();return clone(approvals.filter(a=>a.projectId===projectId));},
  async assistantMessage(projectId,text,intent){await sleep();const p=requireProject(projectId);if(!text.trim())throw new ApiError('VALIDATION','Nachricht ist leer.',false);
    const c:AgentConversation=conversations[projectId]??{id:uid('conversation'),projectId,createdAt:now(),messages:[]};conversations[projectId]=c;
    c.messages.push({id:uid('message'),role:'user',text,kind:'question',createdAt:now(),simulated:true});
    let message:AgentMessage;
    if(intent==='question'){
      const tasks=projectTasks[projectId]??[];const blocked=tasks.filter(t=>t.status==='blocked');const urgent=tasks.filter(t=>t.status!=='done'&&t.dueDate).sort((a,b)=>(a.dueDate??'').localeCompare(b.dueDate??''));
      message={id:uid('message'),role:'assistant',kind:'read_only',simulated:true,createdAt:now(),text:`Lokale Demo-Auswertung (keine KI): ${p.name} hat ${tasks.length} Aufgaben, ${blocked.length} blockiert und ${tasks.filter(t=>t.status==='done').length} erledigt. ${urgent[0]?`Nächste offene Fälligkeit: ${urgent[0].title} (${urgent[0].dueDate}).`: 'Keine anstehenden Fälligkeiten.'} Keine Daten wurden geändert.`};
    }else{
      const base=p.activeDraftVersionId??p.approvedPlanVersionId;if(!base)throw new ApiError('CONFLICT','Kein Plan vorhanden.',false);
      const proposal:ChangeProposal={id:uid('proposal'),projectId,basePlanVersionId:base,summary:text,suggestedTaskTitle:text.slice(0,90),status:'pending',createdAt:now(),source:'local-demo-rule'};
      proposals.unshift(proposal);record(projectId,'proposal','Lokaler Änderungsvorschlag erstellt',`Vorschlag ${proposal.id} wartet auf Prüfung.`);
      message={id:uid('message'),role:'assistant',kind:'proposal',proposalId:proposal.id,simulated:true,createdAt:now(),text:`Demo-Vorschlag ${proposal.id}: „${proposal.suggestedTaskTitle}“ als neue Aufgabe aufnehmen. Noch keine Plan- oder Aufgabenänderung; erst „In Entwurf übernehmen“ erstellt eine neue Planversion.`};
    }
    c.messages.push(message);return clone(message);
  },
  async listConversation(projectId){await sleep();requireProject(projectId);return clone(conversations[projectId]??{id:uid('conversation'),projectId,createdAt:now(),messages:[]});},
  async listProposals(projectId){await sleep();return clone(proposals.filter(p=>p.projectId===projectId));},
  async applyProposal(projectId,proposalId){await sleep();const p=requireProject(projectId),pr=proposals.find(x=>x.id===proposalId&&x.projectId===projectId);
    if(!pr)throw new ApiError('NOT_FOUND','Vorschlag nicht gefunden.',false);if(pr.status!=='pending')throw new ApiError('CONFLICT','Vorschlag bereits bearbeitet.',false);
    const current=p.activeDraftVersionId??p.approvedPlanVersionId;if(current!==pr.basePlanVersionId)throw new ApiError('CONFLICT','Basisversion hat sich geändert. Vorschlag neu erstellen.',false);
    const base=requirePlan(current!);const draft=fork(p,base,'proposal');draft.tasks.push({id:uid('task'),projectId,phaseId:draft.phases[0].id,title:pr.suggestedTaskTitle,description:'Lokaler Beispielvorschlag; fachlich prüfen.',status:'todo',priority:'medium',estimateDays:2,dependsOn:[]});
    pr.status='applied';record(projectId,'proposal','Vorschlag in Entwurf übernommen',`Version ${draft.id}, noch nicht freigegeben.`,'success');return clone(draft);
  },
  async rejectProposal(projectId,proposalId){await sleep();requireProject(projectId);const pr=proposals.find(x=>x.id===proposalId&&x.projectId===projectId);
    if(!pr)throw new ApiError('NOT_FOUND','Vorschlag nicht gefunden.',false);if(pr.status!=='pending')throw new ApiError('CONFLICT','Bereits entschieden.',false);
    pr.status='rejected';record(projectId,'proposal','Vorschlag verworfen',pr.id,'warning');
  },
  async listOperations(projectId){await sleep();return clone(exampleOperations.filter(x=>!projectId||x.projectId===projectId));},
  async listActivity(projectId){await sleep();return clone(history.filter(x=>!projectId||x.projectId===projectId));},
  async getCapabilities(){await sleep();return {mode:'mock',persistence:false,aiAvailable:false,integrations:[{name:'Jira',connected:false,optional:true},{name:'Notion',connected:false,optional:true}]};},
};
/** Test-only reset, followed by fixture setup in each test. */
export function resetMockData(){seed();}
