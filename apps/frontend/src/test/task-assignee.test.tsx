import {beforeEach,describe,it,expect,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import Board from '../pages/Board';
const state=vi.hoisted(()=>({assigned:true}));
const userId='99999999-9999-4999-8999-999999999999';
vi.mock('../api',()=>({isDemoMode:false,projectApi:{listTasks:vi.fn(),listMembers:vi.fn()}}));
vi.mock('../context/AppContext',()=>({useApp:()=>({projects:[{id:'p',name:'Project',description:'',targetDate:''}],refresh:vi.fn(),loading:false})}));
vi.mock('../utils/useReadResource',()=>({useReadResource:()=>({loading:false,error:null,reload:vi.fn(),data:{members:[],tasks:[{id:'task',projectId:'p',phaseId:'phase',title:'Assigned task',description:'',priority:'medium',status:'todo',dependsOn:[],version:1,assigneeId:state.assigned?'99999999-9999-4999-8999-999999999999':undefined}]}})}));
beforeEach(()=>{state.assigned=true});
const show=()=>render(<MemoryRouter initialEntries={['/projects/p/board']}><Routes><Route path="/projects/:projectId/board" element={<Board/>}/></Routes></MemoryRouter>);
describe('persisted assignee without a directory lookup',()=>{
 it('shows the stored UUID in Kanban and List instead of falsely claiming unassigned',()=>{
  show();expect(screen.getByRole('button',{name:'Aufgabe öffnen: Assigned task'})).toHaveTextContent(userId);expect(screen.queryByText('Nicht zugewiesen')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Liste',exact:true}));expect(screen.getByRole('cell',{name:userId})).toBeVisible();
 });
 it('uses unassigned only when no assignee was actually stored',()=>{state.assigned=false;show();expect(screen.getByRole('button',{name:'Aufgabe öffnen: Assigned task'})).toHaveTextContent('Nicht zugewiesen');expect(screen.queryByText(userId)).not.toBeInTheDocument()});
});
