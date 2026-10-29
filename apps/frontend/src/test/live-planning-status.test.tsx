import {describe,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import LivePlanWorkspace from '../pages/LivePlanWorkspace';

const state=vi.hoisted(()=>({failed:false}));
vi.mock('../live/client',()=>({api:{
 project:vi.fn(async()=>({id:'p1',name:'Synthetic project',version:1})),
 plans:vi.fn(async()=>({items:[]})),
 operations:vi.fn(async()=>({items:state.failed?[{id:'op1',kind:'planning',status:'failed',error:'AI_BUDGET_EXHAUSTED'}]:[]})),
 planning:vi.fn(async()=>{state.failed=true}),
}}));
describe('planning operation feedback',()=>{
 it('replaces the queued notice with budget failure and recovery guidance',async()=>{
  state.failed=false;render(<MemoryRouter initialEntries={['/projects/p1/plan']}><Routes><Route path="/projects/:projectId/plan" element={<LivePlanWorkspace/>}/></Routes></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Planungsziel'),'Synthetic goal');
  await userEvent.click(screen.getByRole('button',{name:'Planung anfordern'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('AI-Budget ist ausgeschöpft');
  expect(screen.queryByText(/Planungsauftrag gespeichert/)).not.toBeInTheDocument();
 });
});
