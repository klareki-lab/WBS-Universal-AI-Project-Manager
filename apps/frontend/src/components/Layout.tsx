import { isDemoMode } from '../api';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowRight, Blocks, Bot, CheckCheck, ChevronDown, FolderKanban, LayoutDashboard, Menu, MessageCircleMore, Plus, Settings2, Sparkles, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { de } from '../i18n/de';
import { DemoNotice, ErrorState, Loading } from './UI';
function Logo() { return <div className="flex items-center gap-3"><span className="brand-mark"><Blocks size={25}/></span><div><div className="font-brand text-[25px] font-extrabold leading-7 tracking-[-1.3px]">{de.brand}<span className="text-[#6bdfba]"></span></div><p className="text-[9px] font-bold tracking-[.24em] text-slate-400">{de.brandTagline}</p></div></div>; }
export function Layout() {
  const { projects, loading, error, refresh, selectedProjectId, setSelectedProjectId }=useApp();
  const [open,setOpen]=useState(false);const navigate=useNavigate();const loc=useLocation();const params=useParams();
  const projectId=params.projectId??selectedProjectId??projects[0]?.id;
  useEffect(()=>setOpen(false),[loc.pathname]);
  useEffect(()=>{if(!open)return;const listener=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);},[open]);
  useEffect(()=>{if(params.projectId)setSelectedProjectId(params.projectId);},[params.projectId,setSelectedProjectId]);
  const global=[{label:de.nav.dashboard,path:'/',Icon:LayoutDashboard},{label:de.nav.newProject,path:'/projects/new',Icon:Plus}];
  const local=projectId?[
    {label:de.v2.navigation.workspace,path:`/projects/${projectId}/board`,Icon:FolderKanban},
    {label:de.nav.workspace,path:`/projects/${projectId}/workspace`,Icon:MessageCircleMore},
    {label:de.nav.review,path:`/projects/${projectId}/review`,Icon:CheckCheck},
    {label:de.v2.navigation.assistant,path:`/projects/${projectId}/assistant`,Icon:Bot},
  ]:[];
  const system=[{label:de.nav.activity,path:'/activity',Icon:Activity},{label:de.v2.navigation.settings,path:'/settings',Icon:Settings2}];
  const entries=(items:typeof global)=>items.map(({label,path,Icon})=><NavLink key={path} to={path} end={path==='/'} className={({isActive})=>`nav-link ${isActive?'nav-active':''}`}><Icon size={18} aria-hidden="true"/><span>{label}</span>{path==='/projects/new'&&<ArrowRight size={14} className="ml-auto opacity-40"/>}</NavLink>);
  return <div className="min-h-screen bg-[#f5f7fa]"><a href="#main-content" className="skip-link">Zum Hauptinhalt springen</a>
    {open&&<button className="fixed inset-0 z-30 bg-slate-950/60 lg:hidden" aria-label="Navigation schließen" onClick={()=>setOpen(false)}/>}
    <aside className={`sidebar ${open?'translate-x-0':'-translate-x-full'} lg:translate-x-0`} aria-label="Hauptnavigation"><div className="mb-12 flex items-start justify-between px-6 pt-8"><Logo/><button className="text-white lg:hidden" aria-label="Menü schließen" onClick={()=>setOpen(false)}><X size={23}/></button></div>
      <nav className="flex-1 space-y-7 overflow-auto px-3 pb-8" aria-label="Hauptmenü"><div><p className="nav-heading">{de.nav.overview}</p>{entries(global)}</div><div><p className="nav-heading">{de.nav.planning}</p><label className="mx-3 mb-3 block"><span className="sr-only">{de.common.selectProject}</span><div className="relative"><select className="project-select w-full" value={projectId??''} disabled={!projects.length} onChange={e=>{setSelectedProjectId(e.target.value);if(loc.pathname.startsWith('/projects/')&&!loc.pathname.endsWith('new'))navigate(`/projects/${e.target.value}/board`);}}>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-3.5 text-slate-300"/></div></label>{entries(local)}</div><div><p className="nav-heading">{de.nav.system}</p>{entries(system)}</div></nav>
      {isDemoMode&&<div className="mx-4 mb-5 rounded-[15px] border border-white/10 bg-white/[0.055] p-4"><div className="mb-2 flex items-center gap-2 text-[#8de5cb]"><Sparkles size={16}/><span className="text-xs font-bold uppercase tracking-widest">Demo-Modus</span></div><p className="text-xs leading-5 text-slate-300">Eigene Aufgaben und Pläne – keine Drittanbieter-Verbindung. Alle Änderungen nur im Arbeitsspeicher.</p></div>}</aside>
    <div className="lg:ml-[264px]"><header className="topbar"><div className="flex min-w-0 items-center gap-3"><button className="icon-button lg:hidden" aria-label="Navigation öffnen" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={22}/></button><span className="hidden text-sm font-semibold text-slate-500 sm:inline">Klare KI</span><span className="hidden text-slate-300 sm:inline">/</span><span className="truncate text-sm font-bold text-ink">{projects.find(p=>p.id===projectId)?.name??'Projektübersicht'}</span></div><div className="flex items-center gap-3">{isDemoMode&&<span className="top-demo"><span className="h-2 w-2 rounded-full bg-amber-500"/>{de.demo.short}</span>}<span className="avatar" aria-label="Demo-Nutzer">D</span></div></header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1540px] px-4 pb-14 pt-7 sm:px-7 lg:px-10 lg:pt-9">{loading?<Loading/>:error?<ErrorState text={error} retry={()=>void refresh()}/>:<><div className="mb-6">{isDemoMode&&<DemoNotice compact/>}</div><Outlet/></>}</main>
    </div>
  </div>;
}
