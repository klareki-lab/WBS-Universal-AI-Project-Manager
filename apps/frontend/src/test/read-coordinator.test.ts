import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {coordinateRead,resetReadsForTests,retryAt,recordRateLimit,getRateState,invalidateReads} from '../live/readCoordinator';
import {api,login,clearSession,request,activeSession} from '../live/client';
const fetchMock=vi.fn<typeof fetch>();
const ok=(x:unknown)=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const throttled=(seconds?:string)=>new Response(JSON.stringify({error:{code:'FST_ERR_RATE_LIMIT',message:'Rate limit exceeded',request_id:'g4-limit'}}),{status:429,headers:seconds===undefined?{}:{'Retry-After':seconds}});
beforeEach(()=>{vi.useFakeTimers();resetReadsForTests();clearSession();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);sessionStorage.clear();});
afterEach(async()=>{resetReadsForTests();await vi.advanceTimersByTimeAsync(0);vi.useRealTimers();});
const flush=()=>vi.advanceTimersByTimeAsync(0);

describe('G4 GET reuse and cancellation',()=>{
 it('coalesces simultaneous reads and reuses a short-lived immutable copy',async()=>{
   const loader=vi.fn(async()=>({items:['initial']}));const [a,b]=await Promise.all([coordinateRead('/a',loader),coordinateRead('/a',loader)]);
   a.items.push('local');expect(b.items).toEqual(['initial']);expect((await coordinateRead('/a',loader)).items).toEqual(['initial']);expect(loader).toHaveBeenCalledTimes(1);
   await vi.advanceTimersByTimeAsync(5001);await coordinateRead('/a',loader);expect(loader).toHaveBeenCalledTimes(2);
 });
 it('explicit refresh bypasses fulfilled reuse but shares concurrent reads',async()=>{
   const loader=vi.fn(async()=>1);await coordinateRead('/a',loader);
   await Promise.all([coordinateRead('/a',loader,{fresh:true}),coordinateRead('/a',loader,{fresh:true})]);expect(loader).toHaveBeenCalledTimes(2);
 });
 it('invalidates cached results on writes and authentication changes',async()=>{
   const loader=vi.fn(async()=>1);await coordinateRead('/a',loader);invalidateReads();await coordinateRead('/a',loader);clearSession();await coordinateRead('/a',loader);expect(loader).toHaveBeenCalledTimes(3);
 });
 it('keeps project paths separate',async()=>{
   const a=vi.fn(async()=>({project:'a'})),b=vi.fn(async()=>({project:'b'}));expect((await coordinateRead('/projects/a',a)).project).toBe('a');expect((await coordinateRead('/projects/b',b)).project).toBe('b');expect(a).toHaveBeenCalledOnce();expect(b).toHaveBeenCalledOnce();
 });
 it('one consumer cancellation does not abort another consumer of the same read',async()=>{
   let finish!:(x:number)=>void;let signal!:AbortSignal;
   const loader=vi.fn((s:AbortSignal)=>{signal=s;return new Promise<number>(r=>{finish=r})});const a=new AbortController(),b=new AbortController();
   const first=coordinateRead('/shared',loader,{signal:a.signal}).catch(e=>e),second=coordinateRead('/shared',loader,{signal:b.signal});await flush();a.abort();await flush();expect(signal.aborted).toBe(false);finish(42);
   expect((await first).name).toBe('AbortError');expect(await second).toBe(42);expect(loader).toHaveBeenCalledOnce();
 });
 it('cancels the underlying fetch after the last owner leaves',async()=>{
   let signal!:AbortSignal;const controller=new AbortController();
   const result=coordinateRead('/obsolete',s=>{signal=s;return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))},{signal:controller.signal}).catch(e=>e);
   await flush();controller.abort();await flush();expect(await result).toMatchObject({name:'AbortError'});expect(signal.aborted).toBe(true);
 });
 it('does not dispatch an obsolete read waiting in the bounded queue',async()=>{
   const resolvers:Array<()=>void>=[];let active=0,peak=0;
   const slow=()=>new Promise<number>(r=>{active++;peak=Math.max(peak,active);resolvers.push(()=>{active--;r(1)})});
   const a=coordinateRead('/a',slow),b=coordinateRead('/b',slow);const abort=new AbortController(),third=vi.fn(async()=>3);
   const c=coordinateRead('/c',third,{signal:abort.signal}).catch(e=>e);await flush();expect(peak).toBe(2);abort.abort();resolvers.forEach(r=>r());await Promise.all([a,b]);expect((await c).name).toBe('AbortError');expect(third).not.toHaveBeenCalled();
 });
});

describe('G4 Retry-After and safe recovery',()=>{
 it.each(['-1','1.5','soon','','NaN','999999999999'])('does not guess invalid intervals: %s',raw=>expect(retryAt(new Headers({'Retry-After':raw}))).toBeNull());
 it('uses integer seconds or HTTP-date relative to the server Date',()=>{
   expect(retryAt(new Headers({'Retry-After':'23'}),1000)).toBe(24000);
   expect(retryAt(new Headers({'Date':'Thu, 29 Oct 2026 10:00:00 GMT','Retry-After':'Thu, 29 Oct 2026 10:00:23 GMT'}),1000)).toBe(24000);
   expect(retryAt(new Headers())).toBeNull();
 });
 it('automatically recovers a GET exactly after the permitted interval',async()=>{
   fetchMock.mockResolvedValueOnce(throttled('2')).mockResolvedValueOnce(ok({items:[]}));const value=api.projects();await flush();expect(fetchMock).toHaveBeenCalledTimes(1);expect(getRateState().limited).toBe(true);
   await vi.advanceTimersByTimeAsync(1999);expect(fetchMock).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(await value).toEqual({items:[]});expect(fetchMock).toHaveBeenCalledTimes(2);expect(getRateState().limited).toBe(false);
 });
 it('deduplicates recovery and holds unrelated reads during the cooldown',async()=>{
   fetchMock.mockResolvedValueOnce(throttled('1')).mockImplementation(async()=>ok({items:[]}));const a=api.projects(),b=api.projects();await flush();const c=api.tasks('project');await flush();expect(fetchMock).toHaveBeenCalledTimes(1);
   await vi.advanceTimersByTimeAsync(1000);await Promise.all([a,b,c]);expect(fetchMock).toHaveBeenCalledTimes(3);
 });
 it('cancels obsolete reads during 429 wait without retrying their network request',async()=>{
   const controller=new AbortController();fetchMock.mockResolvedValue(throttled('2'));const result=api.tasks('old',{signal:controller.signal}).catch(e=>e);await flush();controller.abort();await flush();await vi.advanceTimersByTimeAsync(3000);expect(await result).toMatchObject({name:'AbortError'});expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('missing Retry-After stops at an explicit manual state, never guesses from error text',async()=>{
   fetchMock.mockImplementation(async()=>throttled());await expect(api.projects()).rejects.toMatchObject({status:429,retryAt:null});await vi.advanceTimersByTimeAsync(60000);expect(fetchMock).toHaveBeenCalledOnce();expect(getRateState().manual).toBe(true);
 });
 it('bounds repeated 429 recovery instead of polling forever',async()=>{
   fetchMock.mockImplementation(async()=>throttled('1'));const result=api.projects().catch(e=>e);await flush();await vi.advanceTimersByTimeAsync(3000);expect((await result).status).toBe(429);expect(fetchMock).toHaveBeenCalledTimes(3);expect(getRateState().manual).toBe(true);
 });
 it.each([401,403,409])('does not retry HTTP %s',async status=>{
   fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'denied',message:'rejected'}}),{status}));await expect(request('/api/v1/projects')).rejects.toMatchObject({status});await vi.advanceTimersByTimeAsync(30000);expect(fetchMock).toHaveBeenCalledOnce();
 });
 it('never automatically repeats a mutation on 429; explicit retry keeps its key',async()=>{
   fetchMock.mockResolvedValueOnce(ok({user:{id:'human',display_name:'Human'},csrf_token:'csrf'}));await login('qa@example.invalid','synthetic-password');fetchMock.mockClear();
   fetchMock.mockResolvedValueOnce(throttled('2')).mockResolvedValueOnce(ok({id:'original'}));await expect(api.createProject('Name','description')).rejects.toMatchObject({status:429});const key=(fetchMock.mock.calls[0][1]?.headers as Record<string,string>)['Idempotency-Key'];
   expect(activeSession()).toBe(true);await vi.advanceTimersByTimeAsync(2100);expect(fetchMock).toHaveBeenCalledTimes(1);
   await api.createProject('Name','description');expect((fetchMock.mock.calls[1][1]?.headers as Record<string,string>)['Idempotency-Key']).toBe(key);expect(sessionStorage.length).toBe(0);
 });
 it('auth changes do not reuse another session response',async()=>{
   fetchMock.mockResolvedValueOnce(ok({items:['old']})).mockResolvedValueOnce(ok({items:['new']}));expect(await api.projects()).toEqual({items:['old']});clearSession();expect(await api.projects()).toEqual({items:['new']});
 });
 it('does not automatically repeat a failed write during read recovery',async()=>{
   recordRateLimit(Date.now()+1000,'rate');await expect(api.createProject('Name','')).rejects.toMatchObject({status:429});await vi.advanceTimersByTimeAsync(2000);expect(fetchMock).not.toHaveBeenCalled();
 });
});
