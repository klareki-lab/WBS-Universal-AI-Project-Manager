import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {ProjectMemberPicker} from '../components/ProjectMemberPicker';
import {TaskDependencyPicker} from '../components/TaskDependencyPicker';
import {liveApi} from '../api/liveApi';
import {clearSession} from '../live/client';
import {resetReadsForTests} from '../live/readCoordinator';
import {explainError} from '../api/errors';
import type {Task,User} from '../api/types';

const project='11111111-1111-4111-8111-111111111111';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const member=(n:number,extras:Record<string,unknown>={})=>({
 user_id:id(n),display_name:'Mitarbeiter '+n,email:'member'+n+'@example.invalid',
 kind:'human',role:'editor',disabled:false,...extras
});
const people:User[]=[
 {id:id(1),displayName:'Ирина Müller',email:'irina@example.invalid',kind:'human',role:'editor',disabled:false},
 {id:id(2),displayName:'Service Robot',email:'robot@example.invalid',kind:'service',role:'editor',disabled:false},
 {id:id(3),displayName:'Disabled User',email:'disabled@example.invalid',kind:'human',role:'editor',disabled:true}
];
const fetchMock=vi.fn<typeof fetch>();
const response=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status});
beforeEach(()=>{resetReadsForTests();clearSession();sessionStorage.clear();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock)});
describe('G6 paginated scoped member directory',()=>{
 it('loads all pages and maps real member fields without fake fallbacks',async()=>{
  const first=Array.from({length:100},(_,i)=>member(i+1));
  fetchMock.mockResolvedValueOnce(response({items:first,limit:100,offset:0}))
   .mockResolvedValueOnce(response({items:[member(101,{display_name:'Ирина Мюллер'})],limit:100,offset:100}));
  const all=await liveApi.listMembers(project);
  expect(all).toHaveLength(101);
  expect(all[100]).toMatchObject({id:id(101),displayName:'Ирина Мюллер',role:'editor',kind:'human',disabled:false});
  expect(fetchMock.mock.calls.map(([url])=>url)).toEqual([
   '/api/v1/projects/'+project+'/members?limit=100&offset=0',
   '/api/v1/projects/'+project+'/members?limit=100&offset=100'
  ]);
 });
 it('keeps a project authorization failure distinct from an empty directory',async()=>{
  fetchMock.mockResolvedValueOnce(response({error:{code:'project_not_found',message:'not found',request_id:'g6-denied'}},404));
  await expect(liveApi.listMembers(project)).rejects.toMatchObject({status:404,code:'project_not_found'});
 });
 it('fails rather than claim a complete directory when a subsequent page fails',async()=>{
  fetchMock.mockResolvedValueOnce(response({items:Array.from({length:100},(_,i)=>member(i+1)),limit:100,offset:0}))
   .mockResolvedValueOnce(response({error:{code:'rate_limited',message:'wait',request_id:'g6-rate'}},429));
  await expect(liveApi.listMembers(project)).rejects.toMatchObject({status:429,code:'rate_limited'});
 });
 it('rejects invalid backend response shape instead of fabricating people',async()=>{
  fetchMock.mockResolvedValueOnce(response({items:[{user_id:id(1),display_name:'Unknown',disabled:false}],limit:100,offset:0}));
  await expect(liveApi.listMembers(project)).rejects.toThrow('Ungültige Mitgliederdaten');
 });
});

describe('G6 names-only picker and revocation',()=>{
 it('searches Cyrillic and selects an actual active human member ID',()=>{
  const choose=vi.fn();render(<ProjectMemberPicker members={people} selectedId={undefined} onSelect={choose} loaded loading={false} disabled={false}/>);
  const search=screen.getByRole('combobox',{name:'Verantwortlich'});
  fireEvent.focus(search);fireEvent.change(search,{target:{value:'Ирина'}});
  expect(screen.getByRole('option',{name:/Ирина Müller/})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:/Ирина Müller/}));
  expect(choose).toHaveBeenCalledExactlyOnceWith(id(1));
 });
 it('refuses disabled and service identities as new assignees',()=>{
  render(<ProjectMemberPicker members={people} onSelect={vi.fn()} loaded loading={false} disabled={false}/>);
  fireEvent.focus(screen.getByRole('combobox',{name:'Verantwortlich'}));
  expect(screen.queryByRole('option',{name:/Service Robot/})).not.toBeInTheDocument();
  expect(screen.queryByRole('option',{name:/Disabled User/})).not.toBeInTheDocument();
 });
 it('retains a revoked current ID only as a warning and offers explicit removal',()=>{
  const choose=vi.fn();render(<ProjectMemberPicker members={people} selectedId={id(44)} onSelect={choose} loaded loading={false} disabled={false}/>);
  expect(screen.getByText(/Bisherige Zuweisung/)).toBeVisible();
  expect(screen.getByText(/nicht im aktuellen Mitgliederverzeichnis/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Zuweisung entfernen'}));
  expect(choose).toHaveBeenCalledWith(undefined);
 });
 it('shows explicit loading and empty states, never a fake member',()=>{
  const view=render(<ProjectMemberPicker members={[]} onSelect={vi.fn()} loaded={false} loading disabled={false}/>);
  expect(screen.getByRole('status')).toHaveTextContent('geladen');
  expect(screen.getByRole('combobox')).toBeDisabled();
  view.rerender(<ProjectMemberPicker members={[]} onSelect={vi.fn()} loaded loading={false} disabled={false}/>);
  expect(screen.getByText(/Keine aktiven menschlichen Projektmitglieder/)).toBeVisible();
 });
});

const tasks:Task[]=[
 {id:id(10),projectId:project,phaseId:id(1),title:'Eigene Aufgabe',description:'',status:'todo',priority:'medium',estimateDays:0,dependsOn:[]},
 {id:id(11),projectId:project,phaseId:id(1),title:'Analyse der Anfragen',description:'',status:'todo',priority:'medium',estimateDays:0,dependsOn:[]},
 {id:id(12),projectId:project,phaseId:id(1),title:'Implementierung',description:'',status:'todo',priority:'medium',estimateDays:0,dependsOn:[]},
 {id:id(13),projectId:id(999),phaseId:id(1),title:'Fremdes Projekt',description:'',status:'todo',priority:'medium',estimateDays:0,dependsOn:[]}
];
describe('G6 dependency editor',()=>{
 it('shows stored predecessors and lets the user add or remove without duplicates or self-selection',()=>{
  const onChange=vi.fn();
  const props={taskId:id(10),projectId:project,tasks,selected:[id(11)],onChange,disabled:false,loading:false};
  const view=render(<TaskDependencyPicker {...props}/>);
  expect(screen.getByLabelText('Aktuelle Abhängigkeiten')).toHaveTextContent('Analyse der Anfragen');
  expect(screen.queryByRole('checkbox',{name:/Eigene Aufgabe/})).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox',{name:/Fremdes Projekt/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:'Abhängigkeit: Implementierung'}));
  expect(onChange).toHaveBeenCalledWith([id(11),id(12)]);
  view.rerender(<TaskDependencyPicker {...props} selected={[id(11),id(12)]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Abhängigkeit Analyse der Anfragen entfernen'}));
  expect(onChange).toHaveBeenLastCalledWith([id(12)]);
 });
 it('disables edits when persisted predecessor information cannot be read',()=>{
  render(<TaskDependencyPicker taskId={id(10)} projectId={project} tasks={tasks} selected={[]} onChange={vi.fn()}
    disabled loading error="403 Forbidden"/>);
  expect(screen.getByRole('alert')).toHaveTextContent('403 Forbidden');
  expect(screen.getByRole('checkbox',{name:'Abhängigkeit: Implementierung'})).toBeDisabled();
 });
});

describe('G6 server validation messages',()=>{
 it.each([
  [400,'self_dependency_not_allowed','nicht von sich selbst'],
  [400,'duplicate_dependency','mehrfach'],
  [400,'invalid_dependency_reference','nicht zu diesem Projekt'],
  [400,'invalid_assignee','kein aktives'],
  [400,'invalid_plan','Zyklus'],
  [409,'stale_task_version','Versionskonflikt']
 ])('explains status %i / %s in German', (status,code,hint)=>{
  const error=Object.assign(new Error(code==='invalid_plan'?'Dependency cycle':code),{status,code,requestId:'g6-req'});
  expect(explainError(error)).toContain(hint);expect(explainError(error)).toContain('g6-req');
 });
});
