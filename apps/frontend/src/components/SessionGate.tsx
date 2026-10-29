import {useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {ApiError} from '../live/client';
import {auth} from '../api/liveApi';
import {isDemoMode} from '../api';
export function SessionGate({children}:{children:ReactNode}){
 const [state,setState]=useState<'loading'|'login'|'ready'>('loading'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false),[needsLogin,setNeedsLogin]=useState(false);
 useEffect(()=>{if(isDemoMode){setState('ready');return}void auth.session().then(()=>{setNeedsLogin(!auth.activeSession());setState('ready')}).catch(e=>{if(!(e instanceof ApiError&&e.status===401))setError(e instanceof Error?e.message:String(e));setState('login')})},[]);
 async function signIn(event:FormEvent){event.preventDefault();setWorking(true);setError('');try{await auth.login(email,password);setPassword('');setNeedsLogin(false);setState('ready')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setWorking(false)}}
 if(state==='loading')return <main role="status" className="p-12">Klare KI — Sitzung wird geprüft …</main>;
 if(state==='login'||needsLogin)return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4"><form className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg" onSubmit={signIn}><h1 className="text-2xl font-bold">Klare KI</h1><p className="mb-6 text-slate-500">KI Project Studio · {needsLogin?'Sitzung erneut bestätigen':'Anmeldung'}</p><label className="block">E-Mail<input className="field-input" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="mt-4 block">Passwort<input className="field-input" required type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="mt-4 text-red-700">{error}</p>}<button className="btn-primary mt-5" disabled={working}>{working?'Anmeldung läuft …':'Anmelden'}</button></form></main>;
 return <>{children}</>
}