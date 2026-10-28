import type { ProjectApi } from './types';
import { mockApi } from './mockApi';
import { liveApi } from './liveApi';
export const isDemoMode = import.meta.env.VITE_DATA_MODE !== 'live';
export const projectApi: ProjectApi = isDemoMode ? mockApi : liveApi;
