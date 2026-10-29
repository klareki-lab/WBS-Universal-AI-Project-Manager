import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import Activity from '../pages/Activity';
import {de} from '../i18n/de';
import {g4} from '../i18n/g4';
import type {ActivityEvent,OperationJob} from '../api/types';

type ReadData={events:ActivityEvent[];jobs:OperationJob[]};
const state=vi.hoisted(()=>({demo:false,loading:false,error:null as unknown,data:null as ReadData|null}));
vi.mock('../api',()=>({get isDemoMode(){return state.demo},projectApi:{listActivity:vi.fn(),listOperations:vi.fn()}}));
vi.mock('../context/AppContext',()=>({useApp:()=>({selectedProjectId:'project-g4'})}));
vi.mock('../utils/useReadResource',()=>({useReadResource:()=>({...state,reload:vi.fn(async()=>undefined)})}));

beforeEach(()=>{state.demo=false;state.loading=false;state.error=null;state.data=null});

describe('G4 recovery: activity loading is not empty demo history',()=>{
 it.each(['loading','forbidden','throttled'] as const)('does not fabricate empty history during %s before the first response',phase=>{
   state.loading=phase==='loading';
   if(phase!=='loading')state.error=Object.assign(new Error('Controlled read failure'),{status:phase==='forbidden'?403:429,requestId:'fixture-read',code:phase==='forbidden'?'forbidden':'rate_limited'});
   render(<Activity/>);
   expect(screen.getByRole('heading',{name:g4.events})).toBeVisible();
   expect(screen.queryByText(de.activity.noEvents)).not.toBeInTheDocument();
   expect(screen.queryByText(g4.eventsEmpty)).not.toBeInTheDocument();
   expect(screen.queryByText(g4.jobsEmpty)).not.toBeInTheDocument();
   if(phase==='loading')expect(screen.getByText(de.common.loading)).toBeVisible();
   else expect(screen.getByRole('alert')).toBeVisible();
 });
 it('uses the live empty state only after an actual empty read result',()=>{
   state.data={events:[],jobs:[]};render(<Activity/>);
   expect(screen.getByText(g4.eventsEmpty)).toBeVisible();
   expect(screen.getByText(g4.jobsEmpty)).toBeVisible();
   expect(screen.queryByText(de.activity.noEvents)).not.toBeInTheDocument();
   expect(screen.queryByText('Lokale Ereignisse')).not.toBeInTheDocument();
 });
 it('keeps the last successful backend event visible during a failed refresh',()=>{
   state.data={events:[{id:'audit-1',projectId:'project-g4',at:'2026-10-29T09:00:00Z',category:'project',title:'Projekt erstellt',detail:'audit-1',level:'info',simulated:false}],jobs:[]};
   state.error=Object.assign(new Error('Rate limited'),{status:429,requestId:'refresh-429',code:'rate_limited'});
   render(<Activity/>);
   expect(screen.getByText('Projekt erstellt')).toBeVisible();
   expect(screen.getByText('audit-1')).not.toBeVisible(); fireEvent.click(screen.getByText('audit-1').closest('details')!.querySelector('summary')!); expect(screen.getByText('audit-1')).toBeVisible();
   expect(screen.getByRole('alert')).toBeVisible();
   expect(screen.queryByText(de.activity.noEvents)).not.toBeInTheDocument();
   expect(screen.queryByText(g4.eventsEmpty)).not.toBeInTheDocument();
 });
 it('retains explicitly local wording only for the selected demo adapter',()=>{
   state.demo=true;state.data={events:[],jobs:[]};render(<Activity/>);
   expect(screen.getByText('Lokale Ereignisse')).toBeVisible();
   expect(screen.getByText(de.activity.noEvents)).toBeVisible();
   expect(screen.queryByText(g4.eventsEmpty)).not.toBeInTheDocument();
 });
});
