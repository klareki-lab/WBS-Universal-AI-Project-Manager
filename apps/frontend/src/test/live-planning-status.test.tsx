import {beforeEach,describe,it,expect,vi} from 'vitest';
import {fireEvent,waitFor} from '@testing-library/react';
import {api} from '../live/client';
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import LivePlanWorkspace from '../pages/LivePlanWorkspace';

const state=vi.hoisted(()=>({failed:false,draft:false,reviewed:false,published:false,assigned:false}));
beforeEach(()=>{vi.clearAllMocks();state.failed=false;state.draft=false;state.reviewed=false;state.published=false;state.assigned=false;});
vi.mock('../api',()=>({projectApi:{listMembers:vi.fn(async()=>[{id:'member-1',displayName:'Sophie Keller'}])}}));
vi.mock('../live/client',()=>({api:{
 project:vi.fn(async()=>({id:'p1',name:'Synthetic project',version:1})),
 plans:vi.fn(async()=>({items:state.draft?[{id:'manual-v2',project_id:'p1',number:2,base_project_version:1,status:state.published?'published':state.reviewed?'in_review':'draft',content_hash:'a'.repeat(64),created_at:'2026-10-29T10:00:00Z',snapshot:{phases:[{key:'phase',name:'Phase',description:''}],tasks:[{key:'task',phase_key:'phase',title:'Manuell geändert',description:'No AI',priority:'medium',due_date:null,assignee_id:state.assigned?'member-1':null,depends_on:[]}]}}]:[]})),
 approvalHistory:vi.fn(async()=>({items:[],revocations:[]})),
 review:vi.fn(async()=>{state.reviewed=true;}),
 operations:vi.fn(async()=>({items:state.failed?[{id:'op1',kind:'planning',status:'failed',error:'AI_BUDGET_EXHAUSTED'}]:[]})),
 planning:vi.fn(async()=>{state.failed=true}),
}}));
describe('planning operation feedback',()=>{
 it('replaces the queued notice with budget failure and recovery guidance',async()=>{
  state.failed=false;render(<MemoryRouter initialEntries={['/projects/p1/plan']}><Routes><Route path="/projects/:projectId/plan" element={<LivePlanWorkspace/>}/></Routes></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Planungsziel'),'Synthetic goal');
  await userEvent.click(screen.getByRole('button',{name:'Planung anfordern'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('AI-Budget ist ausgesch\u00f6pft');
  expect(screen.queryByText(/Planungsauftrag (im Backend )?gespeichert/)).not.toBeInTheDocument();
 });
 it('prioritizes the exact saved draft and keeps historic failed AI operations in a collapsed history',async()=>{
  state.failed=true;state.draft=true;
  render(<MemoryRouter initialEntries={['/projects/p1/review?plan=manual-v2']}><Routes><Route path="/projects/:projectId/review" element={<LivePlanWorkspace/>}/></Routes></MemoryRouter>);
  const step=await screen.findByTestId('plan-next-step');
  expect(step).toHaveTextContent('Planversion v2');
  expect(step).toHaveTextContent('keine AI-Planung erforderlich');
  expect(screen.getByTestId('plan-version-id')).toHaveTextContent('manual-v2');
  expect(screen.getByText(/Backend-Vorgänge \/ frühere AI-Aufträge/).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('button',{name:'Review einreichen'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Review einreichen'}));
  await waitFor(()=>expect(api.review).toHaveBeenCalledWith('p1','manual-v2'));
  expect(api.planning).not.toHaveBeenCalled();
 });

 it('shows the project member name on the exact assignment draft',async()=>{
  state.draft=true;state.assigned=true;
  render(<MemoryRouter initialEntries={['/projects/p1/review?plan=manual-v2']}><Routes><Route path="/projects/:projectId/review" element={<LivePlanWorkspace/>}/></Routes></MemoryRouter>);
  expect(await screen.findByText(/Sophie Keller/)).toBeInTheDocument();
  expect(screen.getByTestId('plan-hash')).toHaveTextContent('a'.repeat(64));
 });
 it('has exactly one unambiguous header Kanban link after publication',async()=>{
  state.draft=true;state.published=true;
  render(<MemoryRouter initialEntries={['/projects/p1/review?plan=manual-v2']}><Routes><Route path="/projects/:projectId/review" element={<LivePlanWorkspace/>}/></Routes></MemoryRouter>);
  expect(await screen.findByTestId('plan-next-step')).toHaveTextContent('veröffentlicht');
  expect(screen.getAllByRole('link',{name:/^Zum Kanban$/})).toHaveLength(1);
  expect(screen.getByRole('link',{name:'Aufgaben im Kanban anzeigen'})).toHaveAttribute('href','/projects/p1/board');
 });

});
