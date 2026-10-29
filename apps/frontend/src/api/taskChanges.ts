import type {Task} from './types';
import {request, ApiError, type Plan} from '../live/client';
import {taskEditing} from '../i18n/taskEditing';

/** Canonical OpenAPI 1.1.0 taskMetadata request subset. Never includes status/dependencies. */
export interface TaskContentChanges {
  title?: string;
  description?: string;
  priority?: Task['priority'];
  dueDate?: string | null;
  assigneeId?: string | null;
  dependsOn?: string[];
}
interface PersistedTask {
  id: string; project_id: string; version: number; title: string; description: string;
  priority: Task['priority']; assignee_id: string | null; start_date: string | null; due_date: string | null;
  estimated_effort: number | null; definition_of_done: string;
}
type MetadataRequest = {
  version: number;
  title?: string;
  description?: string;
  priority?: Task['priority'];
  due_date?: string | null;
  assignee_id?: string | null;
  start_date: string | null;
  estimated_effort: number | null;
  definition_of_done: string;
  depends_on?: string[];
};
const allowed = new Set(['title','description','priority','dueDate','assigneeId','dependsOn']);

/** Separate from status PATCH: backend returns an immutable draft, NOT an updated Task. */
export async function createTaskChange(task: Task, changes: TaskContentChanges): Promise<Plan> {
  if (!task.projectId || !Number.isInteger(task.version) || !task.version || task.version < 1) {
    throw new Error(taskEditing.versionMissing);
  }
  const keys = Object.keys(changes);
  if (!keys.length || Object.values(changes).every(value=>value===undefined) || keys.some(key => !allowed.has(key))) throw new Error(taskEditing.invalidChanges);
  const path=`/api/v1/projects/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}`;
  // Read the full canonical record, including fields not shown by this panel.
  // Never substitute a newer version for the one the user actually reviewed.
  const current=await request<PersistedTask>(path,'GET',undefined,undefined,{fresh:true});
  if(current.id!==task.id||current.project_id!==task.projectId)throw new Error('Aufgabenbezug ungültig. Keine Änderung gesendet.');
  if(current.version!==task.version)throw new ApiError(409,'stale_task_version','Die Aufgabe wurde inzwischen geändert. Eingaben bleiben erhalten. Bitte den aktuellen Stand prüfen.','');
  if([current.title,current.description,current.definition_of_done].some(x=>typeof x!=='string') ||
    !['low','medium','high','urgent'].includes(current.priority) ||
    [current.assignee_id,current.start_date,current.due_date].some(x=>x!==null&&typeof x!=='string') ||
    (current.estimated_effort!==null&&typeof current.estimated_effort!=='number'))throw new Error('Unvollständige Aufgabenantwort. Keine Änderung gesendet.');
  // The contract includes defaults. Explicitly preserve ALL untouched metadata;
  // do not let omitted fields become null, empty, or medium in a new snapshot.
  const body: MetadataRequest = {version: task.version,title:current.title,description:current.description,
    priority:current.priority,assignee_id:current.assignee_id,start_date:current.start_date,due_date:current.due_date,
    estimated_effort:current.estimated_effort,definition_of_done:current.definition_of_done};
  // Stable property order preserves the existing durable command fingerprint on explicit retries.
  if (changes.title !== undefined) body.title = changes.title;
  if (changes.description !== undefined) body.description = changes.description;
  if (changes.priority !== undefined) body.priority = changes.priority;
  if (changes.dueDate !== undefined) body.due_date = changes.dueDate;
  if (changes.assigneeId !== undefined) body.assignee_id = changes.assigneeId;
  if (changes.dependsOn !== undefined) {
    if (!Array.isArray(changes.dependsOn)||changes.dependsOn.length>500||
      changes.dependsOn.includes(task.id)||new Set(changes.dependsOn).size!==changes.dependsOn.length||
      changes.dependsOn.some(id=>typeof id!=='string'||!id.trim()))
      throw new Error('Ungültige Abhängigkeiten. Keine Änderung gesendet.');
    body.depends_on=changes.dependsOn;
  }
  return request<Plan>(path, 'PATCH', body);
}

/** Compare to the persisted task, not the first task of any plan. Do not trim user input. */
export function taskContentChanges(task: Task, draft: TaskContentChanges): TaskContentChanges {
  const result: TaskContentChanges = {};
  if (draft.title !== undefined && draft.title !== task.title) result.title = draft.title;
  if (draft.description !== undefined && draft.description !== task.description) result.description = draft.description;
  if (draft.priority !== undefined && draft.priority !== task.priority) result.priority = draft.priority;
  if (draft.dueDate !== undefined && (draft.dueDate || null) !== (task.dueDate || null)) result.dueDate = draft.dueDate || null;
  if (draft.assigneeId !== undefined && (draft.assigneeId || null) !== (task.assigneeId || null)) result.assigneeId = draft.assigneeId || null;
  if(draft.dependsOn!==undefined){
    const before=[...new Set(task.dependsOn)].sort();
    const after=[...new Set(draft.dependsOn)].sort();
    if(before.length!==after.length||before.some((id,index)=>id!==after[index]))
      result.dependsOn=draft.dependsOn;
  }
  return result;
}
