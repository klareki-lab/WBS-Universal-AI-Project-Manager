import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {OperationalTaskPanel} from '../components/OperationalTaskPanel';
import type {Task} from '../api/types';
import {liveApi} from '../api/liveApi';
import {login,clearSession} from '../live/client';
import {resetReadsForTests} from '../live/readCoordinator';
vi.mock('../api',()=>({isDemoMode:false}));
const task:Task={id:'task',projectId:'project',phaseId:'phase',title:'Live task',description:'Persistent metadata',priority:'urgent',status:'todo',estimateDays:0,dependsOn:[],version:7};
const fetchMock=vi.fn<typeof fetch>();const ok=(data:unknown)=>new Response(JSON.stringify(data));
beforeEach(()=>{resetReadsForTests();clearSession();sessionStorage.clear();vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset()});
async function auth(){fetchMock.mockResolvedValueOnce(ok({user:{id:'human',display_name:'QA'},csrf_token:'csrf'}));await login('qa@example.invalid','synthetic-password');fetchMock.mockClear()}
describe('G4 live controls and immutable metadata boundary',()=>{
 it('labels backend status editing, locks metadata and only submits a status patch',async()=>{
   const save=vi.fn(async()=>undefined);render(<MemoryRouter><OperationalTaskPanel task={task} tasks={[task]} members={[]} onClose={()=>undefined} onSave={save}/></MemoryRouter>);
   expect(screen.getByText(/BACKEND.*STATUS BEARBEITBAR/)).toBeVisible();expect(screen.queryByText(/LOKALE DEMO/i)).not.toBeInTheDocument();
   expect(screen.getByLabelText('Titel')).toHaveAttribute('readonly');expect(screen.getByLabelText('Beschreibung')).toHaveAttribute('readonly');expect(screen.getByLabelText('Priorit\u00e4t')).toBeDisabled();
   expect(screen.getByRole('button',{name:'Status im Backend speichern'})).toBeDisabled();fireEvent.change(screen.getByLabelText('Status'),{target:{value:'done'}});fireEvent.click(screen.getByRole('button',{name:'Status im Backend speichern'}));await waitFor(()=>expect(save).toHaveBeenCalledExactlyOnceWith({status:'done'}));
 });
 it('retains the dialog with an explicit conflict and never shows a success state',async()=>{
   const close=vi.fn();const save=vi.fn(async()=>{throw Object.assign(new Error('stale'),{status:409,code:'stale_task_version',requestId:'conflict-7'})});
   render(<MemoryRouter><OperationalTaskPanel task={task} tasks={[task]} members={[]} onClose={close} onSave={save}/></MemoryRouter>);
   fireEvent.change(screen.getByLabelText('Status'),{target:{value:'done'}});fireEvent.click(screen.getByRole('button',{name:'Status im Backend speichern'}));expect(await screen.findByRole('alert')).toHaveTextContent('Versionskonflikt');expect(close).not.toHaveBeenCalled();expect(save).toHaveBeenCalledOnce();
 });
 it('uses the displayed task version instead of fetching and overwriting concurrent changes',async()=>{
   await auth();fetchMock.mockResolvedValueOnce(ok({...task,project_id:'project',phase_id:'phase',version:8,status:'done'}));await liveApi.updateTask('project','task',{status:'done'},7);
   expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/projects/project/tasks/task/status');expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({status:'done',version:7});
 });
 it('refuses material task changes without inventing a direct metadata save',async()=>{
   await expect(liveApi.updateTask('project','task',{title:'new'},7)).rejects.toThrow('nicht unterst\u00fctzt');expect(fetchMock).not.toHaveBeenCalled();
 });
 it('loads activity for exactly one project and never uses demo events',async()=>{
   fetchMock.mockResolvedValueOnce(ok({items:[{id:'audit',project_id:'project',type:'project.created',created_at:'2026-10-29T08:00:00Z'}]}));const events=await liveApi.listActivity('project');expect(events[0]).toMatchObject({id:'audit',projectId:'project',simulated:false,title:'Projekt erstellt'});expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/projects/project/activity?limit=100&offset=0');expect(await liveApi.listActivity()).toEqual([]);expect(fetchMock).toHaveBeenCalledOnce();
 });
 it.each([
  ['\u041f\u0440\u043e\u0435\u043a\u0442 \u00ab\u041c\u043e\u0441\u0442\u00bb','\u041f\u0435\u0440\u0432\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430.\n\u0412\u0442\u043e\u0440\u0430\u044f: \u0451, \u0439; API.'],
  ['\u00dcberblick & Qualit\u00e4t','Gr\u00f6\u00dfe pr\u00fcfen.\nZweite Zeile \u2014 unver\u00e4ndert.'],
  ['English launch','First line.\nSecond: \u201cquotes\u201d & punctuation!'],
  ['  Mix \u041a\u0418 / AI  ','  Mixed \u0442\u0435\u043a\u0441\u0442: Stra\u00dfe & e\u0301.\nLine two.  ']
 ])('preserves submitted UTF-8 content without normalization: %s',async(name,description)=>{
   await auth();fetchMock.mockResolvedValueOnce(ok({id:'project',name,description,status:'draft',version:1,created_at:'now',updated_at:'now',published_plan_id:null}));const result=await liveApi.createProject({name,description,type:'custom',targetDate:'',constraints:[]});expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({name,description});expect(result.project.name).toBe(name);expect(result.project.description).toBe(description);
 });
});
