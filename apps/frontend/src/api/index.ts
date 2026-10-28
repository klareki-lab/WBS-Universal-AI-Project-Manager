import type { ProjectApi } from './types';
import { mockApi } from './mockApi';
/** Reconcile the Backend Lead's contract and replace this one line with the live adapter. */
export const projectApi: ProjectApi = mockApi;
export const isDemoMode = true;
