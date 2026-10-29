import { coordinateRead, invalidateReads, isAbort, recordRateLimit, retryAt, getRateState, type ReadOptions } from './readCoordinator';
/** Existing REST v1 subset. The canonical backend contract remains authoritative. */
export type ProjectStatus='draft'|'active'|'on_hold'|'completed'|'archived';
export type TaskStatus='todo'|'in_progress'|'blocked'|'done'|'cancelled';
export type PlanStatus='draft'|'in_review'|'approved'|'published'|'superseded'|'rejected';
export type JobStatus='queued'|'running'|'succeeded'|'failed';
export interface Project {id:string;name:string;description:string;status:ProjectStatus;version:number;published_plan_id:string|null;created_at:string;updated_at:string}
export interface Task {id:string;project_id:string;title:string;description:string;status:TaskStatus;priority:'low'|'medium'|'high'|'urgent';version:number;due_date:string|null;assignee_id:string|null;phase_id:string;source_key:string;source_plan_id:string}
export interface Phase {key:string;name:string;description:string}
export interface PlanTask {key:string;phase_key:string;title:string;description:string;priority:'low'|'medium'|'high'|'urgent';depends_on:string[];due_date:string|null;assignee_id:string|null}
export interface Plan {id:string;project_id:string;number:number;base_project_version:number;status:PlanStatus;content_hash:string;created_at:string;snapshot:{phases:Phase[];tasks:PlanTask[]}}
export interface Operation {id:string;project_id:string;kind:'planning'|'publish';status:JobStatus;error:string|null;result:Record<string,unknown>|null;created_at:string;attempts:number}
export interface Activity {id:string;project_id:string;type?:string;event_type?:string;created_at:string;[key:string]:unknown}
export interface Page<T>{items:T[];limit:number;offset:number}
export interface ProjectMember {
  user_id:string; email:string; display_name:string;
  kind:'human'|'service'; role:'owner'|'editor'|'viewer'; disabled:boolean;
}
export interface TaskDependency { project_id:string; task_id:string; depends_on_id:string }
export class ApiError extends Error {
  constructor(public status:number,public code:string,message:string,public requestId:string,public retryAt:number|null=null){super(message);this.name='ApiError'}
}
const base=(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/,'');
// CSRF is tab-memory only. The HttpOnly session cookie is owned by the server.
let csrf:string|null=null;
export function activeSession(){return typeof csrf==='string' && csrf.length>0}
export function clearSession(){csrf=null;invalidateReads()}
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object' && value!==null}
async function decode(response:Response,write:boolean):Promise<unknown>{
  const requestId=response.headers.get('x-request-id')??'';
  let data:unknown=null;
  if(response.status!==204){
    try{data=await response.json()}
    catch{
      if(response.status===401)clearSession();
      if(response.ok)throw new ApiError(response.status,'invalid_response',write
        ?'Serverantwort unlesbar. Ergebnis unbekannt; vor einer Wiederholung den Serverzustand prüfen.'
        :'Serverantwort unlesbar. Daten erneut laden.',requestId);
    }
  }
  if(!response.ok){
    const error=record(data)&&record(data.error)?data.error:{};
    const code=typeof error.code==='string'?error.code:'http_error';
    if(response.status===401 || (response.status===403 && code==='csrf_required'))clearSession();
    if(response.status===401&&typeof window!=='undefined')window.dispatchEvent(new Event('uapm-auth-required'));
    const retry = response.status===429 ? retryAt(response.headers) : null;
    if(response.status===429)recordRateLimit(retry,typeof error.request_id==='string'?error.request_id:requestId);
    throw new ApiError(response.status,code,typeof error.message==='string'?error.message:'HTTP '+response.status,
      typeof error.request_id==='string'?error.request_id:requestId,retry);
  }
  return data;
}
export async function request<T>(path:string,method:'GET'|'POST'|'PATCH'='GET',body?:unknown,key?:string,options:ReadOptions={}):Promise<T>{
  if(method==='GET')return coordinateRead(path,async signal=>{
    let response:Response;
    try{response=await fetch(base+path,{method:'GET',headers:{},credentials:'include',signal})}
    catch(e){if(isAbort(e)||signal.aborted)throw new DOMException('Abgebrochen','AbortError');throw new ApiError(0,'network_unknown','Netzwerkfehler. Lesen kann erneut versucht werden.','')}
    return await decode(response,false) as T;
  },options,path.startsWith('/api/v1/auth/')?0:path.includes('/operations')?1000:5000);
  const rate=getRateState();
  if(rate.limited&&(rate.manual||(rate.until!==null&&rate.until>Date.now())))throw new ApiError(429,'rate_limited','Bitte die Wartezeit abwarten. Die Aktion wurde nicht erneut gesendet.',rate.requestId,rate.until);
  invalidateReads();
  const headers:Record<string,string>={};
  const write=true;
  if(body!==undefined)headers['Content-Type']='application/json';
  if(write){
    if(!activeSession())throw new ApiError(401,'authentication_required','Bitte erneut anmelden, damit ein CSRF-Token verfügbar ist.','');
    headers['X-CSRF-Token']=csrf!;
    const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([method,path,body]))))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const slot='uapm.pending.'+fingerprint;
    key=key??sessionStorage.getItem(slot)??crypto.randomUUID();
    sessionStorage.setItem(slot,key);
    headers['Idempotency-Key']=key;
  }
  let response:Response;
  try{response=await fetch(base+path,{method,headers,credentials:'include',body:body===undefined?undefined:JSON.stringify(body)})}
  catch{throw new ApiError(0,'network_unknown',write
    ?'Verbindung unterbrochen. Ergebnis unbekannt. Identische Eingabe erneut senden: Der ursprüngliche Idempotenzschlüssel bleibt erhalten.'
    :'Netzwerkfehler. Laden ist erneut möglich.','')}
  // No automatic retry: a mutation may have committed before the response was lost.
  let result:T;
  try{result=await decode(response,write) as T}finally{invalidateReads()}
  // Retain the key after network/5xx/unreadable responses. An explicit retry of
  // identical input (including after reload) recovers the original transaction.
  if(write){for(let i=sessionStorage.length-1;i>=0;i--){const slot=sessionStorage.key(i)!;if(slot.startsWith('uapm.pending.')&&sessionStorage.getItem(slot)===key)sessionStorage.removeItem(slot)}}
  return result;
}
export async function login(email:string,password:string){
  clearSession();
  let response:Response;
  try{response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),credentials:'include'})}
  catch{throw new ApiError(0,'network_unknown','Anmeldung nicht bestätigt. Verbindung prüfen und erneut anmelden.','')}
  const data=await decode(response,true);
  if(!record(data)||typeof data.csrf_token!=='string'||!data.csrf_token||!record(data.user)
    ||typeof data.user.id!=='string'||typeof data.user.display_name!=='string'){
    throw new ApiError(response.status,'invalid_response','Anmeldung nicht bestätigt: ungültige Sitzungsantwort.',response.headers.get('x-request-id')??'');
  }
  csrf=data.csrf_token;
  return {id:data.user.id,display_name:data.user.display_name};
}
export async function session(options:ReadOptions={}){
 const user=await request<{id:string;display_name:string}>('/api/v1/auth/session','GET',undefined,undefined,options);
 const token=await request<{csrf_token:string}>('/api/v1/auth/csrf','GET',undefined,undefined,options);
 if(!token.csrf_token)throw new ApiError(200,'invalid_response','CSRF-Bootstrap fehlgeschlagen','');
 csrf=token.csrf_token;return user;
}
export async function logout(){await request<unknown>('/api/v1/auth/logout','POST');clearSession()}
const p=(id:string)=>'/api/v1/projects/'+encodeURIComponent(id);
const one=(id:string)=>'/api/v1/operations/'+encodeURIComponent(id);
export const api={
 projects:(options:ReadOptions={})=>request<Page<Project>>('/api/v1/projects?limit=100&offset=0','GET',undefined,undefined,options),
 project:(id:string,options:ReadOptions={})=>request<Project>(p(id),'GET',undefined,undefined,options),
 createProject:(name:string,description:string,key?:string)=>request<Project>('/api/v1/projects','POST',{name,description},key),
 dashboard:(id:string,options:ReadOptions={})=>request<{total:number;progress_percent:number;by_status:Record<string,number>}>(p(id)+'/dashboard','GET',undefined,undefined,options),
 tasks:(id:string,options:ReadOptions={},offset=0)=>request<Page<Task>>(p(id)+'/tasks?limit=100&offset='+offset,'GET',undefined,undefined,options),
 members:(id:string,options:ReadOptions={},offset=0)=>request<Page<ProjectMember>>(p(id)+'/members?limit=100&offset='+offset,'GET',undefined,undefined,options),
 dependencies:(id:string,taskId:string,options:ReadOptions={})=>request<{items:TaskDependency[]}>(p(id)+'/tasks/'+encodeURIComponent(taskId)+'/dependencies','GET',undefined,undefined,options),
 status:(id:string,task:Pick<Task,'id'|'version'>,status:TaskStatus,key?:string)=>request<Task>(p(id)+'/tasks/'+task.id+'/status','PATCH',{version:task.version,status},key),
 plans:(id:string,options:ReadOptions={})=>request<Page<Plan>>(p(id)+'/plans?limit=100&offset=0','GET',undefined,undefined,options),
 plan:(id:string,version:string,options:ReadOptions={})=>request<Plan>(p(id)+'/plans/'+version,'GET',undefined,undefined,options),
 createPlan:(id:string,projectVersion:number,snapshot:Plan['snapshot'],key?:string)=>request<Plan>(p(id)+'/plans','POST',{base_project_version:projectVersion,snapshot},key),
 review:(id:string,version:string,key?:string)=>request<Plan>(p(id)+'/plans/'+version+'/submit-review','POST',undefined,key),
 requestApproval:(id:string,version:string,key?:string)=>request<Plan>(p(id)+'/plans/'+version+'/request-approval','POST',undefined,key),
 decision:(id:string,plan:Plan,decision:'approved'|'rejected',comment:string,key?:string)=>request<unknown>(p(id)+'/plans/'+plan.id+'/approvals','POST',{content_hash:plan.content_hash,decision,comment},key),
 publish:(id:string,plan:Plan,key?:string)=>request<Operation>(p(id)+'/plans/'+plan.id+'/publish','POST',{content_hash:plan.content_hash},key),
 planning:(id:string,prompt:string,key?:string)=>request<Operation>(p(id)+'/agent/planning-requests','POST',{prompt},key),
 operations:(id:string,options:ReadOptions={})=>request<Page<Operation>>(p(id)+'/operations?limit=100&offset=0','GET',undefined,undefined,options),
 operation:(id:string,options:ReadOptions={})=>request<Operation>(one(id),'GET',undefined,undefined,options),
 approvalHistory:(id:string,planId:string,options:ReadOptions={})=>request<{items:Array<{id:string;plan_version_id:string;user_id:string;decision:'approved'|'rejected';created_at:string}>;revocations:Array<{approval_id:string;reason:string;source:string}>}>(p(id)+'/plans/'+encodeURIComponent(planId)+'/approvals','GET',undefined,undefined,options),
 revoke:(id:string,planId:string,reason:string)=>request(p(id)+'/plans/'+encodeURIComponent(planId)+'/revoke-approval','POST',{reason}),
 activity:(id:string,options:ReadOptions={})=>request<Page<Activity>>(p(id)+'/activity?limit=100&offset=0','GET',undefined,undefined,options)
};
