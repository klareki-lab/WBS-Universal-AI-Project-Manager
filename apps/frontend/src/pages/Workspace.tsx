import { isDemoMode } from '../api';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Check, Clock3, MessageSquareText, Send, ShieldAlert, Sparkles, UserRound } from 'lucide-react';
import { projectApi } from '../api';
import { explainError } from '../api/errors';
import type { Task, TaskEdit } from '../api/types';
import { ProjectPlan } from '../components/ProjectPlan';
import { TaskEditor } from '../components/TaskEditor';
import { Card, EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from '../components/UI';
import { useApp } from '../context/AppContext';
import { de } from '../i18n/de';
import { useProjectPlan } from '../utils/useProjectPlan';
interface Message { id: number; role: 'user' | 'demo'; text: string; }
export default function Workspace() {
  const { project, plan, loading, error, reload, projectId } = useProjectPlan();
  const { refresh } = useApp();
  const [editing, setEditing] = useState<Task | null>(null);
  const [input, setInput] = useState(''); const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'demo', text: de.workspace.welcome }]);
  const [sending, setSending] = useState(false); const [chatError, setChatError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false); const [adopting, setAdopting] = useState<number | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const canEdit = plan?.status === 'draft' && Boolean(project?.activeDraftVersionId);
  const startDraft = async () => { if (!projectId) return; setStarting(true); setChatError(null); try { const next = await projectApi.createDraftFromApproved(projectId); setNotice(`Neuer lokaler Entwurf v${next.version} erstellt.`); await Promise.all([reload(), refresh()]); } catch (e) { setChatError(explainError(e)); } finally { setStarting(false); } };
  const send = async (event: FormEvent) => { event.preventDefault(); if (!input.trim()) return; const message = input.trim(); setInput(''); setChatError(null); setMessages((prev) => [...prev, { id: Date.now(), role: 'user', text: message }]); setSending(true); try { const reply = await projectApi.demoPlanningReply(message); setMessages((prev) => [...prev, { id: Date.now()+1, role: 'demo', text: reply.message }]); } catch (e) { setChatError(explainError(e)); } finally { setSending(false); } };
  const adopt = async (message: Message) => { if (!projectId || !plan || !canEdit) return; setAdopting(message.id); setChatError(null); try { const next = await projectApi.addTaskFromDescription(projectId, plan.id, message.text); setNotice(`Demo-Aufgabe in Entwurfsversion v${next.version} übernommen. ID: ${next.id}`); await Promise.all([reload(), refresh()]); } catch (e) { setChatError(explainError(e)); } finally { setAdopting(null); } };
  const save = async (edit: TaskEdit) => { if (!projectId || !plan || !editing) return; const next = await projectApi.reviseTask(projectId, plan.id, editing.id, edit); setNotice(`Lokale Entwurfsversion v${next.version} erstellt · ${next.id}`); await Promise.all([reload(), refresh()]); };
  if (loading) return <Loading/>; if (error) return <ErrorState text={error} retry={() => void reload()}/>;
  if (!project || !plan) return <EmptyState text="Kein Plan gefunden."/>;
  return <><PageHeader kicker={de.workspace.kicker} title={de.workspace.title} subtitle={`${project.name} · ${de.workspace.subtitle}`} action={<Link className="btn-secondary inline-flex items-center gap-2" to={`/projects/${project.id}/review`}>{de.workspace.viewReview}<ArrowRight size={16}/></Link>}/>
    {notice && <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status"><Check size={17}/>{notice}</div>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(340px,.81fr)_minmax(420px,1.19fr)]">
      <Card className="flex min-h-[650px] flex-col overflow-hidden"><div className="border-b border-slate-100 p-5 sm:p-6"><div className="flex items-center gap-3"><span className="stat-icon bg-emerald-50 text-emerald-700"><MessageSquareText size={20}/></span><div><h2 className="font-bold text-ink">{de.workspace.conversation}</h2><p className="text-xs text-slate-500">{de.workspace.conversationIntro}</p></div></div></div>
        <div className="flex-1 space-y-6 p-5 sm:p-6" aria-live="polite">{messages.map((m) => <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${m.role === 'user' ? 'bg-slate-200 text-ink' : 'bg-[#dbf4e9] text-emerald-700'}`}>{m.role === 'user' ? <UserRound size={18}/> : <Bot size={19}/>}</div><div className={`max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}><p className="mb-2 text-xs font-semibold text-slate-500">{m.role === 'user' ? 'Du' : de.workspace.agent}</p><div className={`rounded-2xl px-4 py-3 text-sm leading-6 ${m.role === 'user' ? 'bg-[#203752] text-white' : 'bg-slate-100 text-slate-700'}`}>{m.text}</div>{m.role === 'user' && canEdit && <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline" disabled={adopting !== null} onClick={() => void adopt(m)}><Sparkles size={13}/>{adopting === m.id ? 'Wird übernommen …' : de.workspace.adopt}</button>}</div></div>)}{sending && <div className="flex items-center gap-2 text-xs text-slate-400" role="status"><Clock3 size={15}/>{isDemoMode?'Demo-Regel antwortet …':'Backend-Anfrage läuft …'}</div>}</div>
        <div className="border-t border-slate-100 p-5 sm:p-6">{chatError && <div className="mb-3"><ErrorState text={chatError}/></div>}<div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><ShieldAlert size={14} className="mt-0.5 shrink-0"/>{isDemoMode?de.demo.rule:'LIVE: Diese Chatfunktion speichert keine Planfreigabe.'}</div><form onSubmit={(e) => void send(e)} className="flex items-end gap-2"><label className="flex-1"><span className="sr-only">Planungsnachricht</span><textarea className="field-input min-h-[54px] resize-none" rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder={de.workspace.inputPh}/></label><button className="btn-primary h-[54px] px-4" type="submit" disabled={!input.trim() || sending} aria-label={de.workspace.send}><Send size={19}/></button></form></div>
      </Card>
      <Card className="min-w-0 p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-ink">{de.workspace.structured}</h2><p className="mt-1 text-xs text-slate-500">{plan.tasks.length} Aufgaben · {plan.phases.length} Phasen</p></div><StatusBadge status={plan.status}/></div><div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${canEdit ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}><div className="mb-1 font-bold">{canEdit ? de.workspace.draft : de.workspace.approved} · v{plan.version}</div><div className="break-all font-mono text-xs opacity-70">{plan.id}</div></div>
        {!canEdit && <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><div className="flex gap-2"><ShieldAlert size={17} className="shrink-0"/>{de.workspace.noDraft}</div><button type="button" disabled={starting} className="btn-secondary mt-3" onClick={() => void startDraft()}>{starting ? "Neuer Entwurf wird vorbereitet …" : "Neuen Planentwurf starten"}</button></div>}
        <ProjectPlan plan={plan} onEdit={canEdit ? setEditing : undefined}/>
        <div className="mt-6 border-t border-slate-100 pt-5"><Link className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:underline" to={`/projects/${project.id}/review`}>Abhängigkeiten und Risiken prüfen<ArrowRight size={16}/></Link></div>
      </Card>
    </div>
    {editing && canEdit && <TaskEditor task={editing} allTasks={plan.tasks} onSave={save} onClose={() => setEditing(null)}/>}
  </>;
}
