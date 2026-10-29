import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../live/client';
import { auth } from '../api/liveApi';
import { isDemoMode } from '../api';
import { explainError } from '../api/errors';
import { useReadResource } from '../utils/useReadResource';
import type { ReadOptions } from '../live/readCoordinator';
import { RateLimitNotice } from './RateLimitNotice';
import { ErrorState, Loading } from './UI';
export function SessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading'|'login'|'ready'|'recoverable'>('loading');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
  const submitting = useRef(false);
  const bootstrap = useCallback((options: ReadOptions) => isDemoMode ? Promise.resolve(null) : auth.session(options), []);
  const read = useReadResource('session', bootstrap);
  useEffect(() => {
    if (read.data !== undefined) { setState('ready'); setError(''); }
    else if (read.error) {
      const e = read.error; setError(explainError(e));
      setState(e instanceof ApiError && (e.status === 401 || e.code === 'invalid_response') ? 'login' : 'recoverable');
    }
  }, [read.data, read.error]);
  useEffect(() => { const expired=()=>{setState('login');setError('Sitzung abgelaufen. Bitte erneut anmelden.');}; window.addEventListener('uapm-auth-required',expired);return()=>window.removeEventListener('uapm-auth-required',expired); }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return; submitting.current=true; setWorking(true); setError('');
    try { await auth.login(email,password); setPassword(''); setState('ready'); }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitting.current=false; setWorking(false); }
  }
  if (state==='loading'||state==='recoverable') return <main className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-bold">Klare KI</h1><p className="my-4">KI Project Studio</p><RateLimitNotice retry={()=>void read.reload()}/>{state==='loading'?<Loading label={'Sitzung wird gepr\u00fcft ...'}/>:<ErrorState text={error} retry={()=>void read.reload()}/>}</main>;
  if(state==='login') return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4"><form className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg" onSubmit={signIn}><h1 className="text-2xl font-bold">Klare KI</h1><p className="mb-6 text-slate-500">KI Project Studio - Anmeldung</p><RateLimitNotice/><label className="block">E-Mail<input className="field-input" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="mt-4 block">Passwort<input className="field-input" autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="mt-4 text-red-700">{error}</p>}<button className="btn-primary mt-5" disabled={working}>{working?'Anmeldung l\u00e4uft ...':'Anmelden'}</button></form></main>;
  return <>{children}</>;
}
