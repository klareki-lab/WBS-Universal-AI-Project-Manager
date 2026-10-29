import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, resetMockData } from '../api/mockApi';
import type { NewProjectInput, TaskEdit } from '../api/types';
const input:NewProjectInput={name:'Testprojekt',description:'Interner Kundenprozess soll verbessert werden',type:'operations',targetDate:'2027-05-03',constraints:[]};
beforeEach(()=>resetMockData());
describe('standalone project manager mock contract',()=>{
  it('creates native project with editable plan but without external connection',async()=>{
    const {project,plan}=await mockApi.createProject(input);expect(project.activeDraftVersionId).toBe(plan.id);expect(plan.status).toBe('draft');
    expect(await mockApi.listTasks(project.id)).toEqual([]);
    expect((await mockApi.getCapabilities()).persistence).toBe(false);
  });
  it('supports direct task creation and updates without approving a plan',async()=>{
    const {project}=await mockApi.createProject(input);const task=await mockApi.createTask(project.id,{title:'Manuell',description:'Ohne AI',priority:'high'});
    const changed=await mockApi.updateTask(project.id,task.id,{status:'done',assigneeId:'u-demo'});
    expect(changed.status).toBe('done');expect((await mockApi.getProject(project.id)).progress).toBe(100);
  });
  it('keeps old plan snapshot and detects version conflicts',async()=>{
    const {project,plan}=await mockApi.createProject(input);const original=plan.tasks[0];const patch:TaskEdit={title:'Geändert',description:'Text',status:'todo',priority:'high',estimateDays:2,dueDate:undefined,dependsOn:[]};
    const updated=await mockApi.reviseTask(project.id,plan.id,original.id,patch);
    expect(updated.id).not.toBe(plan.id);expect((await mockApi.getPlan(plan.id)).tasks[0].title).toBe(original.title);
    expect((await mockApi.diffPlan(project.id,updated.id)).changes.length).toBeGreaterThan(0);
    await expect(mockApi.reviseTask(project.id,plan.id,original.id,patch)).rejects.toMatchObject({code:'CONFLICT',retrySafe:false});
  });
  it('approves an exact immutable snapshot and publishes tasks to native board',async()=>{
    const {project,plan}=await mockApi.createProject(input);const approval=await mockApi.approveVersion(project.id,plan.id);
    expect(approval.planVersionId).toBe(plan.id);expect((await mockApi.listTasks(project.id)).length).toBe(plan.tasks.length);
    await expect(mockApi.approveVersion(project.id,plan.id)).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('keeps AI proposal isolated until an explicit draft operation',async()=>{
    const {project,plan}=await mockApi.createProject(input);
    const response=await mockApi.assistantMessage(project.id,'Datenschutz prüfen','propose');expect(response.kind).toBe('proposal');
    expect((await mockApi.getPlan(plan.id)).tasks).toHaveLength(4);
    const next=await mockApi.applyProposal(project.id,response.proposalId!);
    expect(next.status).toBe('draft');expect(next.tasks).toHaveLength(5);expect((await mockApi.listTasks(project.id))).toEqual([]);
    await expect(mockApi.applyProposal(project.id,response.proposalId!)).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('prevents cyclic dependencies on the live task board',async()=>{
    const {project}=await mockApi.createProject(input);const a=await mockApi.createTask(project.id,{title:'A',description:'',priority:'medium'});
    const b=await mockApi.createTask(project.id,{title:'B',description:'',priority:'medium'});
    await mockApi.updateTask(project.id,a.id,{dependsOn:[b.id]});
    await expect(mockApi.updateTask(project.id,b.id,{dependsOn:[a.id]})).rejects.toMatchObject({code:'VALIDATION'});
  });
  it('supports reject and revision request without touching operational tasks',async()=>{
    const {project,plan}=await mockApi.createProject(input);const revised=await mockApi.requestRevision(project.id,plan.id,'Mehr Details');
    expect(revised.warnings.some(w=>w.title.includes('Überarbeitung'))).toBe(true);
    await mockApi.rejectVersion(project.id,revised.id,'Nicht bereit');expect((await mockApi.getPlan(revised.id)).status).toBe('rejected');
    expect(await mockApi.listTasks(project.id)).toEqual([]);
  });
});
