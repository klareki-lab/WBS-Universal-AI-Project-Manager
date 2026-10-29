import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {AppProvider,useApp} from '../context/AppContext';
vi.mock('../api',()=>({projectApi:{listProjects:vi.fn(async()=>[{id:'a',name:'Project A'},{id:'b',name:'Project B'}])}}));
function View(){const {projects,selectedProjectId,setSelectedProjectId,focusProject,setFocusProject}=useApp();return <><p data-testid="projects">{projects.map(p=>p.name).join(',')}</p><p data-testid="selected">{selectedProjectId}</p><button onClick={()=>setSelectedProjectId('b')}>Select B</button><button onClick={()=>setFocusProject(!focusProject)}>Toggle focus</button></>}
beforeEach(()=>sessionStorage.clear());
describe('presentation project focus',()=>{
 it('filters only the visible list, restores all projects and retains the selected project across remount',async()=>{
  const view=render(<AppProvider><View/></AppProvider>);expect(await screen.findByText('Project A,Project B')).toBeVisible();fireEvent.click(screen.getByText('Select B'));fireEvent.click(screen.getByText('Toggle focus'));expect(screen.getByTestId('projects')).toHaveTextContent('Project B');expect(sessionStorage.getItem('uapm.projectFocus')).toBe('1');view.unmount();render(<AppProvider><View/></AppProvider>);expect(await screen.findByText('Project B')).toBeVisible();expect(screen.getByTestId('selected')).toHaveTextContent('b');fireEvent.click(screen.getByText('Toggle focus'));expect(screen.getByTestId('projects')).toHaveTextContent('Project A,Project B');
 });
});
