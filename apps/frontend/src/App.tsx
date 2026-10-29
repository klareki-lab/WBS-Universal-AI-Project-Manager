import {isDemoMode} from './api';
import LivePlanWorkspace from './pages/LivePlanWorkspace';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionGate } from './components/SessionGate';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import NewProject from './pages/NewProject';
import Workspace from './pages/Workspace';
import Review from './pages/Review';
import Approval from './pages/Approval';
import Board from './pages/Board';
import Settings from './pages/Settings';
import Activity from './pages/Activity';
import ProjectTeam from './pages/ProjectTeam';
import Assistant from './pages/Assistant';
export function App(){return <SessionGate><BrowserRouter><AppProvider><Routes><Route element={<Layout/>}>
  <Route path="/" element={<Dashboard/>}/><Route path="/projects/new" element={<NewProject/>}/>
  <Route path="/projects/:projectId/board" element={<Board/>}/><Route path="/projects/:projectId/team" element={<ProjectTeam/>}/><Route path="/projects/:projectId/workspace" element={isDemoMode?<Workspace/>:<LivePlanWorkspace/>}/>
  <Route path="/projects/:projectId/review" element={isDemoMode?<Review/>:<LivePlanWorkspace/>}/><Route path="/projects/:projectId/approval" element={isDemoMode?<Approval/>:<LivePlanWorkspace/>}/>
  <Route path="/projects/:projectId/assistant" element={<Assistant/>}/><Route path="/activity" element={<Activity/>}/>
  <Route path="/settings" element={<Settings/>}/><Route path="/integrations" element={<Navigate to="/settings" replace/>}/>
  <Route path="*" element={<Navigate to="/" replace/>}/>
</Route></Routes></AppProvider></BrowserRouter></SessionGate>;}
