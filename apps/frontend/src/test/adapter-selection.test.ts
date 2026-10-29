import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(()=>{vi.resetModules();vi.stubGlobal('fetch',vi.fn())});
describe('one shared adapter for the existing UI',()=>{
  it('uses the isolated demo adapter without network calls in mock mode',async()=>{
    vi.stubEnv('VITE_DATA_MODE','mock');const {projectApi,isDemoMode}=await import('../api');const {mockApi}=await import('../api/mockApi');
    expect(isDemoMode).toBe(true);expect(projectApi).toBe(mockApi);expect((await projectApi.listProjects()).length).toBeGreaterThan(0);expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the live adapter when live mode is explicitly configured',async()=>{
    vi.stubEnv('VITE_DATA_MODE','live');const {projectApi,isDemoMode}=await import('../api');const {liveApi}=await import('../api/liveApi');
    expect(isDemoMode).toBe(false);expect(projectApi).toBe(liveApi);
  });
  it('preserves canonical project, cancelled task and urgent priority values',async()=>{
    vi.stubEnv('VITE_DATA_MODE','live');const {projectApi}=await import('../api');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:'project-1',name:'Persisted project',description:'',status:'on_hold',version:2,published_plan_id:null,created_at:'2026-10-28T12:00:00Z',updated_at:'2026-10-28T12:00:00Z'}],limit:100,offset:0})))
      .mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:'task-1',project_id:'project-1',phase_id:'phase-1',source_key:'stopped-task',source_plan_id:'plan-1',title:'Stopped task',description:'',status:'cancelled',priority:'urgent',version:3,due_date:null,assignee_id:null}],limit:100,offset:0})))
      .mockResolvedValueOnce(new Response(JSON.stringify({id:'plan-1',snapshot:{phases:[],tasks:[{key:'stopped-task',depends_on:[]}]}})));
    expect((await projectApi.listProjects())[0].status).toBe('on_hold');const task=(await projectApi.listTasks('project-1'))[0];expect(task.status).toBe('cancelled');expect(task.priority).toBe('urgent');
  });
  it('never falls back to mock data when the live backend returns 401',async()=>{
    vi.stubEnv('VITE_DATA_MODE','live');const {projectApi}=await import('../api');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'session_expired',message:'Session expired',request_id:'req-401'}}),{status:401}));
    await expect(projectApi.listProjects()).rejects.toMatchObject({status:401,code:'session_expired'});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects an unsupported live mutation without calling a fabricated endpoint',async()=>{
    vi.stubEnv('VITE_DATA_MODE','live');const {projectApi}=await import('../api');
    await expect(projectApi.createTask('project-1',{title:'Task',description:'',priority:'medium'})).rejects.toThrow('nicht unterstützt');expect(fetch).not.toHaveBeenCalled();
  });
});
