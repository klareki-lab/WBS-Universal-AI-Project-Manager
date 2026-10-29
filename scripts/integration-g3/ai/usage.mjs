// Local, read-only usage report; no prompts, credentials, response bodies or network access.
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function summarize(db, warningUsd=null) {
 const rows=db.prepare('SELECT status,usage FROM calls').all();
 let inputTokens=0,outputTokens=0,unknownUsage=0;
 for(const row of rows){let u;try{u=JSON.parse(row.usage)}catch{} if(!u||!Number.isFinite(u.prompt_tokens)||!Number.isFinite(u.completion_tokens)){unknownUsage++;continue}inputTokens+=u.prompt_tokens;outputTokens+=u.completion_tokens}
 const estimatedUsd=(inputTokens*0.4+outputTokens*1.6)/1e6;
 return {calls:rows.length,successful:rows.filter(r=>r.status==='success').length,inputTokens,outputTokens,estimatedUsd,unknownUsage,warningUsd,warning:warningUsd!==null&&estimatedUsd>=warningUsd};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 let warningUsd=null;try{const a=JSON.parse(await readFile(root+'.g3/ai-development-authorization.json','utf8'));if(Number.isFinite(a.warningUsd)&&a.warningUsd>0)warningUsd=a.warningUsd}catch{}
 const report={rates:'gpt-4.1-mini: USD 0.40/million input, USD 1.60/million output; estimate only',note:'Missing usage may still be billable; warning is informational, not a spending cap.'};
 for(const [mode,path] of [['acceptance','ai-budget.sqlite'],['development','ai-development-budget.sqlite']]){try{const db=new DatabaseSync(root+'.g3/'+path,{readOnly:true});try{report[mode]=summarize(db,mode==='development'?warningUsd:null)}finally{db.close()}}catch(e){if(e.code==='ERR_SQLITE_ERROR'||e.code==='ENOENT')report[mode]='ledger unavailable';else throw e}}
 console.log(JSON.stringify(report,null,2));
}
