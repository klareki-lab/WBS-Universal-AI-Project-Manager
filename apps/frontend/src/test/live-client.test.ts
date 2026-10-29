import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeSession, api, clearSession, login, logout, request, session, type Task } from '../live/client';
import { explainError } from '../api/errors';

const fetchMock=vi.fn<typeof fetch>();
const user={id:'11111111-1111-4111-8111-111111111111',display_name:'QA User'};
const ok=(data:unknown,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const denied=(status:number,code:string)=>ok({error:{code,message:'Request rejected',request_id:'req-test'}},status);
async function authenticate(){fetchMock.mockResolvedValueOnce(ok({user,csrf_token:'test-csrf'}));await login('qa@example.invalid','test-only-password');fetchMock.mockClear()}
beforeEach(()=>{clearSession();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);localStorage.clear();sessionStorage.clear()});

describe('human session and CSRF transport',()=>{
  it('includes cookies on login and retains CSRF only in memory',async()=>{
    await authenticate();expect(activeSession()).toBe(true);expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
    fetchMock.mockResolvedValueOnce(ok({id:'project'}));await api.createProject('Project','Description','command-001');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects',expect.objectContaining({credentials:'include',method:'POST',headers:expect.objectContaining({'X-CSRF-Token':'test-csrf','Idempotency-Key':'command-001'})}));
  });
  it('bootstraps CSRF from a cookie-backed session after reload',async()=>{
    fetchMock.mockResolvedValueOnce(ok(user)).mockResolvedValueOnce(ok({csrf_token:'restored-csrf'}));
    expect(await session()).toEqual(user);expect(activeSession()).toBe(true);
    fetchMock.mockResolvedValueOnce(ok({id:'project'}));await api.createProject('Project','');
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({'X-CSRF-Token':'restored-csrf'});
    expect(localStorage.length).toBe(0);
  });
  it('retains the original idempotency key after an ambiguous write and CSRF restoration',async()=>{
    await authenticate();fetchMock.mockRejectedValueOnce(new TypeError('connection lost'));
    await expect(api.createProject('Synthetic','')).rejects.toMatchObject({code:'network_unknown'});
    const key=(fetchMock.mock.calls[0][1]?.headers as Record<string,string>)['Idempotency-Key'];
    clearSession();fetchMock.mockResolvedValueOnce(ok(user)).mockResolvedValueOnce(ok({csrf_token:'restored'}));await session();
    fetchMock.mockResolvedValueOnce(ok({id:'original'}));await api.createProject('Synthetic','');
    expect((fetchMock.mock.calls[fetchMock.mock.calls.length-1]?.[1]?.headers as Record<string,string>)['Idempotency-Key']).toBe(key);
    expect(sessionStorage.length).toBe(0);
  });
  it('does not authenticate a malformed successful login response',async()=>{
    fetchMock.mockResolvedValueOnce(ok({user}));await expect(login('qa@example.invalid','test-only-password')).rejects.toMatchObject({code:'invalid_response'});expect(activeSession()).toBe(false);
  });
  it('clears old CSRF on a rejected new login',async()=>{
    await authenticate();fetchMock.mockResolvedValueOnce(denied(401,'invalid_credentials'));
    await expect(login('qa@example.invalid','invalid')).rejects.toMatchObject({status:401,requestId:'req-test'});expect(activeSession()).toBe(false);
  });
  it('clears CSRF when the server reports session expiry',async()=>{
    await authenticate();fetchMock.mockResolvedValueOnce(denied(401,'session_expired'));
    await expect(api.projects()).rejects.toMatchObject({code:'session_expired'});expect(activeSession()).toBe(false);
  });
  it('invalidates rejected CSRF but preserves a session on a project authorization failure',async()=>{
    await authenticate();fetchMock.mockResolvedValueOnce(denied(403,'forbidden'));
    await expect(api.projects()).rejects.toMatchObject({status:403});expect(activeSession()).toBe(true);
    fetchMock.mockResolvedValueOnce(denied(403,'csrf_required'));
    await expect(api.createProject('Project','')).rejects.toMatchObject({code:'csrf_required'});expect(activeSession()).toBe(false);
  });
  it('confirms logout through the backend before clearing local CSRF',async()=>{
    await authenticate();fetchMock.mockResolvedValueOnce(ok(null,204));await logout();expect(activeSession()).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout',expect.objectContaining({method:'POST',credentials:'include',body:undefined}));
  });
});

describe('errors, optimistic versions and uncertain outcomes',()=>{
  it('retains the caller idempotency key when explicitly replaying an identical command',async()=>{
    await authenticate();fetchMock.mockRejectedValueOnce(new TypeError('lost connection')).mockResolvedValueOnce(ok({id:'project'}));
    await expect(api.createProject('Project','','stable-command')).rejects.toMatchObject({status:0,code:'network_unknown'});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await api.createProject('Project','','stable-command');
    for(const [,options] of fetchMock.mock.calls)expect(options?.headers).toHaveProperty('Idempotency-Key','stable-command');
  });
  it('never auto-retries a write with a lost response',async()=>{
    await authenticate();fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(api.createProject('Project','')).rejects.toThrow('Ergebnis unbekannt');expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not treat a malformed 2xx response as successful persistence',async()=>{
    await authenticate();fetchMock.mockResolvedValueOnce(new Response('not-json',{status:200}));
    await expect(api.createProject('Project','')).rejects.toMatchObject({code:'invalid_response'});expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('sends the displayed version on status updates and preserves conflict evidence',async()=>{
    await authenticate();const task:Task={id:'task-1',project_id:'project-1',phase_id:'phase-1',source_key:'task',source_plan_id:'plan',title:'Task',description:'',priority:'urgent',status:'todo',version:7,due_date:null,assignee_id:null};
    fetchMock.mockResolvedValueOnce(denied(409,'stale_task_version'));
    const error=await api.status('project-1',task,'in_progress','status-key').catch((e:unknown)=>e);
    expect(error).toMatchObject({status:409,code:'stale_task_version',requestId:'req-test'});
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({version:7,status:'in_progress'});
    expect(explainError(error)).toContain('Request-ID req-test');expect(explainError(error)).toContain('neu laden');
  });
  it('uses response header request IDs when a gateway returns a non-JSON error',async()=>{
    fetchMock.mockResolvedValueOnce(new Response('gateway unavailable',{status:502,headers:{'x-request-id':'gateway-req'}}));
    await expect(api.projects()).rejects.toMatchObject({status:502,requestId:'gateway-req'});
  });
  it('polling is read-only, authorized by cookies and never submits a new operation',async()=>{
    const job={id:'job-1',status:'running'};fetchMock.mockResolvedValueOnce(ok(job));
    expect(await api.operation('job-1')).toEqual(job);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/operations/job-1',expect.objectContaining({method:'GET',credentials:'include'}));
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Idempotency-Key');
  });
  it('a transport failure on a read remains an explicit error, not demo data',async()=>{
    fetchMock.mockRejectedValue(new TypeError('offline'));await expect(request('/api/v1/projects')).rejects.toMatchObject({code:'network_unknown'});expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
