
/** Canonical REST v1.0.0 subset, validated against packages/contracts/openapi.yaml on feat/backend-core. */
export type ProjectStatus='draft'|'active'|'on_hold'|'completed'|'archived';
export type TaskStatus='todo'|'in_progress'|'blocked'|'done'|'cancelled';
export type PlanStatus='draft'|'in_review'|'approved'|'published'|'superseded'|'rejected';
export type JobStatus='queued'|'running'|'succeeded'|'failed';
export interface Project {id:string;name:string;description:string;status:ProjectStatus;version:number;published_plan_id:string|null;created_at:string;updated_at:string}
export interface Task {id:string;project_id:string;title:string;description:string;status:TaskStatus;priority:'low'|'medium'|'high'|'urgent';version:number;due_date:string|null;assignee_id:string|null;phase_id:string}
export interface Phase {key:string;name:string;description:string}
export interface PlanTask {key:string;phase_key:string;title:string;description:string;priority:'low'|'medium'|'high'|'urgent';depends_on:string[];due_date:string|null;assignee_id:string|null}
export interface Plan {id:string;project_id:string;number:number;base_project_version:number;status:PlanStatus;content_hash:string;created_at:string;snapshot:{phases:Phase[];tasks:PlanTask[]}}
export interface Operation {id:string;project_id:string;kind:'planning'|'publish';status:JobStatus;error:string|null;result:Record<string,unknown>|null;created_at:string;attempts:number}
export interface Activity {id:string;project_id:string;type?:string;event_type?:string;created_at:string;[key:string]:unknown}
export interface Page<T>{items:T[];limit:number;offset:number}
export class ApiError extends Error {constructor(public status:number,public code:string,message:string,public requestId:string){super(message);this.name='ApiError'}}
const base=(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/,'');
let csrf:string|null=null;
export function activeSession(){return csrf!==null}
export function clearSession(){csrf=null}
export async function request<T>(path:string,method:'GET'|'POST'|'PATCH'='GET',body?:unknown,key?:string):Promise<T>{
 const headers:Record<string,string>={};
 if(body!==undefined) headers['Content-Type']='application/json';
 if(method!=='GET'){
   if(!csrf)throw new ApiError(401,'authentication_required','Bitte erneut anmelden, damit ein CSRF-Token verfügbar ist.','');
   headers['X-CSRF-Token']=csrf;
   headers['Idempotency-Key']=key??crypto.randomUUID();
 }
 let response:Response;
 try{response=await fetch(base+path,{method,headers,credentials:'include',body:body===undefined?undefined:JSON.stringify(body)});}
 catch{throw new ApiError(0,'network_unknown',method==='GET'?'Netzwerkfehler. Laden ist erneut möglich.':'Verbindung unterbrochen. Ergebnis unbekannt; Aktion nicht erneut ausführen, bevor der Serverzustand geprüft wurde.','')}
 let data:unknown=null;
 if(response.status!==204){try{data=await response.json()}catch{data=null}}
 if(!response.ok){
  const envelope=data as {error?:{code?:string;message?:string;request_id?:string}}|null;
  const e=envelope?.error;
  throw new ApiError(response.status,e?.code??'http_error',e?.message??'HTTP '+response.status,e?.request_id??response.headers.get('x-request-id')??'');
 }
 return data as T;
}
export async function login(email:string,password:string){
 const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),credentials:'include'});
 const data=await response.json();
 if(!response.ok)throw new ApiError(response.status,data?.error?.code??'invalid_login',data?.error?.message??'Anmeldung fehlgeschlagen',data?.error?.request_id??'');
 csrf=data.csrf_token;return data.user as {id:string;display_name:string};
}
export async function session(){return request<{id:string;display_name:string}>('/api/v1/auth/session')}
export async function logout(){await request<unknown>('/api/v1/auth/logout','POST');clearSession()}
const p=(id:string)=>'/api/v1/projects/'+encodeURIComponent(id);
const one=(id:string)=>'/api/v1/operations/'+encodeURIComponent(id);
export const api={
 projects:()=>request<Page<Project>>('/api/v1/projects?limit=100&offset=0'),
 project:(id:string)=>request<Project>(p(id)),
 createProject:(name:string,description:string,key?:string)=>request<Project>('/api/v1/projects','POST',{name,description},key),
 dashboard:(id:string)=>request<{total:number;progress_percent:number;by_status:Record<string,number>}>(p(id)+'/dashboard'),
 tasks:(id:string)=>request<Page<Task>>(p(id)+'/tasks?limit=100&offset=0'),
 status:(id:string,task:Task,status:TaskStatus,key?:string)=>request<Task>(p(id)+'/tasks/'+task.id+'/status','PATCH',{version:task.version,status},key),
 plans:(id:string)=>request<Page<Plan>>(p(id)+'/plans?limit=100&offset=0'),
 plan:(id:string,version:string)=>request<Plan>(p(id)+'/plans/'+version),
 createPlan:(id:string,projectVersion:number,snapshot:Plan['snapshot'],key?:string)=>request<Plan>(p(id)+'/plans','POST',{base_project_version:projectVersion,snapshot},key),
 review:(id:string,version:string,key?:string)=>request<Plan>(p(id)+'/plans/'+version+'/submit-review','POST',undefined,key),
 requestApproval:(id:string,version:string,key?:string)=>request<Plan>(p(id)+'/plans/'+version+'/request-approval','POST',undefined,key),
 decision:(id:string,plan:Plan,decision:'approved'|'rejected',comment:string,key?:string)=>request<unknown>(p(id)+'/plans/'+plan.id+'/approvals','POST',{content_hash:plan.content_hash,decision,comment},key),
 publish:(id:string,plan:Plan,key?:string)=>request<Operation>(p(id)+'/plans/'+plan.id+'/publish','POST',{content_hash:plan.content_hash},key),
 planning:(id:string,prompt:string,key?:string)=>request<Operation>(p(id)+'/agent/planning-requests','POST',{prompt},key),
 operations:(id:string)=>request<Page<Operation>>(p(id)+'/operations?limit=100&offset=0'),
 operation:(id:string)=>request<Operation>(one(id)),
 activity:(id:string)=>request<Page<Activity>>(p(id)+'/activity?limit=100&offset=0')
};
