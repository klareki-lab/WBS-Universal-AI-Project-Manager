import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createTaskChange,taskContentChanges,type TaskContentChanges} from '../api/taskChanges';
import {login,clearSession} from '../live/client';
import {resetReadsForTests,allowManualReadRetry} from '../live/readCoordinator';
import type {Task} from '../api/types';
const task:Task={id:'second-task',projectId:'project',phaseId:'phase',title:'Original',description:'Old content',priority:'medium',status:'todo',estimateDays:0,dependsOn:['first-task'],version:7,dueDate:'2026-12-15',assigneeId:'existing-user'};
const stored={id:task.id,project_id:task.projectId,version:7,title:task.title,description:task.description,priority:task.priority,due_date:task.dueDate,assignee_id:task.assigneeId,start_date:'2026-11-01',estimated_effort:5,definition_of_done:'Must remain unchanged'};
const metadata={version:7,title:stored.title,description:stored.description,priority:stored.priority,assignee_id:stored.assignee_id,start_date:stored.start_date,due_date:stored.due_date,estimated_effort:stored.estimated_effort,definition_of_done:stored.definition_of_done};
const fetchMock=vi.fn<typeof fetch>();const ok=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const plan={id:'draft-version',project_id:'project',number:2,status:'draft',content_hash:'a'.repeat(64),snapshot:{phases:[],tasks:[]}};
beforeEach(()=>{resetReadsForTests();clearSession();sessionStorage.clear();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock)});
async function auth(){fetchMock.mockResolvedValueOnce(ok({user:{id:'human',display_name:'QA'},csrf_token:'csrf'}));await login('qa@example.invalid','synthetic-password');fetchMock.mockClear()}
const readThenWrite=(response:Response)=>fetchMock.mockResolvedValueOnce(ok(stored)).mockResolvedValueOnce(response);
describe('task metadata is a backend draft, not a direct task overwrite',()=>{
 it('PATCHes the selected task and observed version, preserving all unedited canonical fields',async()=>{
  await auth();readThenWrite(ok(plan,201));const result=await createTaskChange(task,{title:'Edited second task',priority:'urgent',dueDate:null,assigneeId:null});
  expect(fetchMock).toHaveBeenCalledTimes(2);const [url,options]=fetchMock.mock.calls[1];expect(url).toBe('/api/v1/projects/project/tasks/second-task');expect(options?.method).toBe('PATCH');expect(options?.credentials).toBe('include');
  expect(JSON.parse(String(options?.body))).toEqual({...metadata,title:'Edited second task',priority:'urgent',due_date:null,assignee_id:null});expect(options?.headers).toMatchObject({'X-CSRF-Token':'csrf','Idempotency-Key':expect.any(String)});expect(result).toEqual(plan);expect(task.title).toBe('Original');
 });
 it('sends Unicode and multiline descriptions without trimming or normalizing',async()=>{
  await auth();const description='  \u0422\u0435\u043a\u0441\u0442 / Gr\u00f6\u00dfe / English\n e\u0301 & \u201cquotes\u201d.  ';readThenWrite(ok(plan,201));await createTaskChange(task,{description});expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({...metadata,description});
 });
 it.each(['status','version'])('rejects unsupported %s rather than silently ignoring it',async key=>{await expect(createTaskChange(task,{[key]:'x'} as TaskContentChanges)).rejects.toThrow('nichts gesendet');expect(fetchMock).not.toHaveBeenCalled()});
 it('sends metadata, assignee and predecessors together in one immutable draft',async()=>{
  await auth();readThenWrite(ok(plan,201));
  await createTaskChange(task,{title:'Review updates',assigneeId:null,dependsOn:['first-task','third-task']});
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({...metadata,title:'Review updates',assignee_id:null,depends_on:['first-task','third-task']});
  expect(task.dependsOn).toEqual(['first-task']);
 });
 it('sends an explicit empty dependency array when all predecessors are removed',async()=>{
  await auth();readThenWrite(ok(plan,201));await createTaskChange(task,{dependsOn:[]});
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({...metadata,depends_on:[]});
 });
 it('refuses duplicate and self edges without submitting a PATCH',async()=>{
  await auth();fetchMock.mockResolvedValueOnce(ok(stored));
  await expect(createTaskChange(task,{dependsOn:['second-task']})).rejects.toThrow('Ungültige Abhängigkeiten');
  expect(fetchMock).toHaveBeenCalledOnce();
  fetchMock.mockResolvedValueOnce(ok(stored));
  await expect(createTaskChange(task,{dependsOn:['first-task','first-task']})).rejects.toThrow('Ungültige Abhängigkeiten');
  expect(fetchMock).toHaveBeenCalledTimes(2);
 });
 it('does not substitute a fresh task version to bypass a concurrent change',async()=>{
  await auth();fetchMock.mockResolvedValueOnce(ok({...stored,version:8}));await expect(createTaskChange(task,{description:'new'})).rejects.toMatchObject({status:409,code:'stale_task_version'});expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
 });
 it('also respects a backend conflict after the preflight read',async()=>{
  await auth();readThenWrite(ok({error:{code:'stale_task_version',message:'stale',request_id:'conflict'}},409));await expect(createTaskChange(task,{description:'new'})).rejects.toMatchObject({status:409,requestId:'conflict'});expect(fetchMock).toHaveBeenCalledTimes(2);
 });
 it('never automatically retries a lost write, and explicit replay keeps the original key',async()=>{
  await auth();fetchMock.mockResolvedValueOnce(ok(stored)).mockRejectedValueOnce(new TypeError('Lost response'));await expect(createTaskChange(task,{description:'new'})).rejects.toMatchObject({code:'network_unknown'});expect(fetchMock).toHaveBeenCalledTimes(2);
  const key=(fetchMock.mock.calls[1][1]?.headers as Record<string,string>)['Idempotency-Key'];readThenWrite(ok(plan,201));await createTaskChange(task,{description:'new'});expect((fetchMock.mock.calls[3][1]?.headers as Record<string,string>)['Idempotency-Key']).toBe(key);
 });
 it('does not auto-retry a 429 write and preserves its key for explicit recovery',async()=>{
  await auth();readThenWrite(new Response(JSON.stringify({error:{code:'rate_limited',message:'wait',request_id:'rate'}}),{status:429,headers:{'Retry-After':'0'}}));await expect(createTaskChange(task,{title:'new'})).rejects.toMatchObject({status:429});expect(fetchMock).toHaveBeenCalledTimes(2);const key=(fetchMock.mock.calls[1][1]?.headers as Record<string,string>)['Idempotency-Key'];allowManualReadRetry();readThenWrite(ok(plan,201));await createTaskChange(task,{title:'new'});expect((fetchMock.mock.calls[3][1]?.headers as Record<string,string>)['Idempotency-Key']).toBe(key);
 });
 it('does not send a request without an observed task version',async()=>{await expect(createTaskChange({...task,version:undefined},{title:'new'})).rejects.toThrow('version fehlt');expect(fetchMock).not.toHaveBeenCalled()});
 it('refuses incomplete read data instead of silently wiping unedited metadata',async()=>{await auth();fetchMock.mockResolvedValueOnce(ok({...stored,definition_of_done:undefined}));await expect(createTaskChange(task,{title:'new'})).rejects.toThrow('Keine');expect(fetchMock).toHaveBeenCalledOnce()});
 it('omits unchanged fields from user intent and represents cleared optional fields as null',()=>{
  expect(taskContentChanges(task,{title:'Original',description:'Old content',priority:'medium',dueDate:'2026-12-15',assigneeId:'existing-user'})).toEqual({});
  expect(taskContentChanges(task,{description:'  Changed  ',dueDate:'',assigneeId:''})).toEqual({description:'  Changed  ',dueDate:null,assigneeId:null});
  expect(taskContentChanges(task,{dependsOn:['first-task']})).toEqual({});
  expect(taskContentChanges(task,{dependsOn:[]})).toEqual({dependsOn:[]});
  expect(taskContentChanges(task,{dependsOn:['third-task','first-task']})).toEqual({dependsOn:['third-task','first-task']});
 });
});
