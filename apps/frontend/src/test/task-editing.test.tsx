import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {OperationalTaskPanel} from '../components/OperationalTaskPanel';
import {taskEditing} from '../i18n/taskEditing';
import type {Task} from '../api/types';
const mocks=vi.hoisted(()=>({create:vi.fn(),demo:false}));
vi.mock('../api',()=>({get isDemoMode(){return mocks.demo}}));
vi.mock('../api/taskChanges',async importOriginal=>({...await importOriginal<typeof import('../api/taskChanges')>(),createTaskChange:mocks.create}));
const task:Task={id:'second-task',projectId:'project',phaseId:'phase',title:'Original',description:'Old content',priority:'medium',status:'todo',estimateDays:0,dependsOn:[],version:7};
const receipt={id:'exact-draft',number:2,project_id:'project',status:'draft',content_hash:'b'.repeat(64)};
beforeEach(()=>{mocks.create.mockReset();mocks.demo=false});
function show(){const close=vi.fn(),save=vi.fn(async()=>undefined);render(<MemoryRouter><OperationalTaskPanel task={task} tasks={[task]} members={[]} onClose={close} onSave={save}/></MemoryRouter>);return {close,save}}
describe('editable task content with human-approved draft publication',()=>{
 it('makes supported fields editable from the details panel and keeps status a separate command',()=>{
  show();fireEvent.click(screen.getByRole('button',{name:taskEditing.edit}));
  expect(screen.getByLabelText('Titel')).not.toHaveAttribute('readonly');expect(screen.getByLabelText('Beschreibung')).not.toHaveAttribute('readonly');expect(screen.getByLabelText('Priorit\u00e4t')).toBeEnabled();expect(screen.getByLabelText('F\u00e4lligkeit')).toBeEnabled();expect(screen.getByLabelText('Status')).toBeDisabled();expect(screen.getByRole('button',{name:taskEditing.save})).toBeDisabled();
 });
 it('saves only changed fields, keeps the published task unchanged, and links the exact stored draft',async()=>{
  const {close,save}=show();mocks.create.mockResolvedValue(receipt);fireEvent.click(screen.getByRole('button',{name:taskEditing.edit}));fireEvent.change(screen.getByLabelText('Beschreibung'),{target:{value:'\u041d\u043e\u0432\u044b\u0439 \u0442\u0435\u043a\u0441\u0442\nDeutsch / English'}});fireEvent.click(screen.getByRole('button',{name:taskEditing.save}));
  await waitFor(()=>expect(mocks.create).toHaveBeenCalledExactlyOnceWith(task,{description:'\u041d\u043e\u0432\u044b\u0439 \u0442\u0435\u043a\u0441\u0442\nDeutsch / English'}));
  expect(await screen.findByTestId('task-draft-saved')).toHaveTextContent('Noch nicht freigegeben');expect(screen.getByRole('link',{name:taskEditing.review})).toHaveAttribute('href','/projects/project/review?plan=exact-draft');expect(save).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(task.description).toBe('Old content');expect(screen.getByRole('button',{name:taskEditing.save})).toBeDisabled();
 });
 it('retains all input and the modal on a version conflict without any success message',async()=>{
  const {close}=show();mocks.create.mockRejectedValue(Object.assign(new Error('stale'),{status:409,requestId:'conflict',code:'stale_task_version'}));fireEvent.click(screen.getByRole('button',{name:taskEditing.edit}));fireEvent.change(screen.getByLabelText('Titel'),{target:{value:'My unsaved title'}});fireEvent.click(screen.getByRole('button',{name:taskEditing.save}));expect(await screen.findByRole('alert')).toHaveTextContent('Versionskonflikt');expect(screen.getByLabelText('Titel')).toHaveValue('My unsaved title');expect(screen.queryByTestId('task-draft-saved')).not.toBeInTheDocument();expect(close).not.toHaveBeenCalled();
 });
 it('blocks repeated submits while a draft write is in flight',async()=>{
  show();let resolve!:(value:unknown)=>void;mocks.create.mockImplementation(()=>new Promise(r=>{resolve=r}));fireEvent.click(screen.getByRole('button',{name:taskEditing.edit}));fireEvent.change(screen.getByLabelText('Titel'),{target:{value:'Changed'}});const button=screen.getByRole('button',{name:taskEditing.save});fireEvent.click(button);fireEvent.click(button);expect(mocks.create).toHaveBeenCalledOnce();resolve(receipt);await screen.findByTestId('task-draft-saved');
 });
 it('cancels editing without sending any write',()=>{const {save}=show();fireEvent.click(screen.getByRole('button',{name:taskEditing.edit}));fireEvent.change(screen.getByLabelText('Beschreibung'),{target:{value:'Not saved'}});fireEvent.click(screen.getByRole('button',{name:taskEditing.cancelEdit}));expect(screen.getByLabelText('Beschreibung')).toHaveValue('Old content');expect(mocks.create).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()});
 it('keeps explicit demo saves local and never invokes the metadata endpoint',async()=>{
  mocks.demo=true;const {save}=show();fireEvent.change(screen.getByLabelText('Beschreibung'),{target:{value:'Demo only'}});fireEvent.submit(screen.getByLabelText('Beschreibung').closest('form')!);await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(mocks.create).not.toHaveBeenCalled();
 });
});
