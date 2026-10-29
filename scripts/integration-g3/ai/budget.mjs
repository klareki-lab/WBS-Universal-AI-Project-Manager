import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFile, chmod, access} from 'node:fs/promises';
export const limits = Object.freeze({model:'gpt-4.1-mini', calls:3, outputTokens:1200, inputBytes:12000, reserveUsd:0.01, ceilingUsd:0.03, timeoutMs:10000});
const stages = ['coordinator','planner','reviewer'];
export function authorizationValid(mode,a) {
  return a?.authorized===true && typeof a.ownerDecision==='string' && a.ownerDecision.trim().length>0 && (mode==='acceptance' ? a.maxUsd===0.05 : mode==='development' && a.mode==='development' && Number.isFinite(a.warningUsd) && a.warningUsd>0);
}
export function ledger(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, stage TEXT NOT NULL,
    request_hash TEXT NOT NULL, reserved_usd REAL NOT NULL, created_at TEXT NOT NULL,
    status TEXT NOT NULL, provider_request_id TEXT, completion_id TEXT, usage TEXT,
    UNIQUE(operation_id,stage));`);
  return db;
}
export function reserve(db, operation, stage, body, {mode='acceptance', otherDb}={}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!['acceptance','development'].includes(mode)) throw new Error('AI_MODE_INVALID');
    if (otherDb?.prepare('SELECT 1 FROM calls WHERE operation_id=? LIMIT 1').get(operation)) throw new Error('AI_REPLAY_OR_STAGE_ORDER');
    const count = db.prepare('SELECT count(*) n,coalesce(sum(reserved_usd),0) usd FROM calls').get();
    if (mode === 'acceptance' && (count.n >= limits.calls || count.usd + limits.reserveUsd > limits.ceilingUsd + 1e-9)) throw new Error('AI_BUDGET_EXHAUSTED');
    const previous = db.prepare('SELECT stage,status FROM calls WHERE operation_id=? ORDER BY id').all(operation);
    if (previous.length !== stages.indexOf(stage) || previous.some((p,i) => p.stage !== stages[i] || p.status !== 'success')) throw new Error('AI_REPLAY_OR_STAGE_ORDER');
    const r = db.prepare('INSERT INTO calls(operation_id,stage,request_hash,reserved_usd,created_at,status) VALUES(?,?,?,?,?,?)').run(operation,stage,createHash('sha256').update(body).digest('hex'),limits.reserveUsd,new Date().toISOString(),'reserved');
    db.exec('COMMIT'); return r.lastInsertRowid;
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
export function budgetServer({db, otherDb, mode='acceptance', authorized, verifyOperation, upstream = fetch, timeoutMs = limits.timeoutMs, maxConcurrency=2}) {
  if (!['acceptance','development'].includes(mode) || !Number.isInteger(maxConcurrency) || maxConcurrency<1 || maxConcurrency>2) throw new Error('AI_MODE_INVALID');
  let inFlight=0;
  return createServer(async (req,res) => {
    const send = (code, value) => { res.writeHead(code,{'content-type':'application/json'}); res.end(JSON.stringify(value)); };
    let reservation, acquired=false;
    try {
      const match = /^\/operations\/([a-f0-9-]{36})\/(coordinator|planner|reviewer)\/v1\/chat\/completions$/.exec(req.url);
      if (req.method !== 'POST' || !match) return send(404,{error:{message:'AI_ROUTE_DENIED'}});
      if (!await authorized()) return send(403,{error:{message:'AI_EXPENSE_NOT_AUTHORIZED'}});
      if (!/^Bearer \S+$/.test(req.headers.authorization||'')) return send(401,{error:{message:'AI_CREDENTIAL_MISSING'}});
      let size=0; const chunks=[];
      for await (const chunk of req) { size+=chunk.length; if(size>limits.inputBytes) return send(413,{error:{message:'AI_INPUT_LIMIT'}}); chunks.push(chunk); }
      const raw=Buffer.concat(chunks).toString('utf8'), body=JSON.parse(raw);
      if(body.model!==limits.model || body.max_tokens!==limits.outputTokens || body.stream || body.n>1 || body.tools?.length || body.functions?.length || body.response_format?.type!=='json_object' || !Array.isArray(body.messages) || body.messages.some(m=>!['user','system'].includes(m.role)||typeof m.content!=='string')) return send(400,{error:{message:'AI_REQUEST_LIMIT'}});
      await verifyOperation(match[1]);
      // Reservation commits BEFORE network I/O; crashes/timeouts consume it permanently.
      if(inFlight>=maxConcurrency) throw new Error('AI_CONCURRENCY_LIMIT');
      inFlight++; acquired=true;
      reservation=reserve(db,match[1],match[2],raw,{mode,otherDb});
      const response=await upstream('https://api.openai.com/v1/chat/completions',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
        headers:{authorization:req.headers.authorization,'content-type':'application/json'},body:raw,
      });
      db.prepare('UPDATE calls SET provider_request_id=? WHERE id=?').run(response.headers.get('x-request-id'),reservation);
      const reader=response.body?.getReader(); if(!reader) throw new Error('AI_PROVIDER_EMPTY');
      const parts=[];let bytes=0;
      for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>64000){await reader.cancel();throw new Error('AI_PROVIDER_LIMIT')}parts.push(r.value)}
      const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(payload.usage && Number.isFinite(payload.usage.prompt_tokens) && Number.isFinite(payload.usage.completion_tokens)) db.prepare('UPDATE calls SET usage=? WHERE id=?').run(JSON.stringify({prompt_tokens:payload.usage.prompt_tokens,completion_tokens:payload.usage.completion_tokens,total_tokens:payload.usage.total_tokens}),reservation);
      if(!response.ok) throw new Error('AI_PROVIDER_UNAVAILABLE');
      if(payload.model?.startsWith(limits.model)!==true || payload.choices?.length!==1 || payload.choices[0].finish_reason!=='stop' || typeof payload.choices[0].message?.content!=='string' || payload.usage?.completion_tokens>limits.outputTokens) throw new Error('AI_PROVIDER_RESPONSE_INVALID');
      db.prepare('UPDATE calls SET status=?,provider_request_id=?,completion_id=?,usage=? WHERE id=?').run('success',response.headers.get('x-request-id'),payload.id||null,JSON.stringify(payload.usage||null),reservation);
      send(200,payload);
    } catch(e) {
      // Never log provider errors, headers, key, prompt or raw response.
      const code = ['AI_BUDGET_EXHAUSTED','AI_REPLAY_OR_STAGE_ORDER','AI_OPERATION_INVALID','AI_PROVIDER_EMPTY','AI_PROVIDER_LIMIT','AI_PROVIDER_UNAVAILABLE','AI_PROVIDER_RESPONSE_INVALID','AI_CONCURRENCY_LIMIT'].includes(e.message)?e.message:'AI_REQUEST_OR_PROVIDER_FAILED';
      if(reservation) db.prepare('UPDATE calls SET status=? WHERE id=?').run(code,reservation);
      send(502,{error:{message:code}});
    } finally { if(acquired) inFlight--; }
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const {root,database}=await import('../runtime.mjs');
  const {default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');
  const {operationContextHash}=await import(root+'/apps/backend/dist/apps/backend/src/domain.js');
  const pool=new pg.Pool({connectionString:database});
  const mode=process.env.G3_AI_BUDGET_MODE || 'acceptance';
  if(!['acceptance','development'].includes(mode)) throw new Error('Invalid G3_AI_BUDGET_MODE');
  const acceptancePath=root+'/.g3/ai-budget.sqlite', devPath=root+'/.g3/ai-development-budget.sqlite';
  // Never recreate a missing acceptance ledger; that would erase its lifetime limit.
  await access(acceptancePath);
  const db=ledger(mode==='acceptance'?acceptancePath:devPath); await chmod(mode==='acceptance'?acceptancePath:devPath,0o600);
  let otherDb; const otherPath=mode==='acceptance'?devPath:acceptancePath;
  try { await access(otherPath); } catch(e) { if(e.code!=='ENOENT' || mode==='development') throw e; }
  try { await access(otherPath); otherDb=new DatabaseSync(otherPath,{readOnly:true}); } catch(e) { if(e.code!=='ENOENT') throw e; }
  const authorized=async()=>{try{const path=mode==='acceptance'?'/ai-expense-authorization.json':'/ai-development-authorization.json';const a=JSON.parse(await readFile(root+'/.g3'+path,'utf8'));return authorizationValid(mode,a)}catch{return false}};
  const verifyOperation=async id=>{
    const {rows}=await pool.query("SELECT o.*,p.version,p.status project_status,u.disabled,u.kind creator_kind,m.role FROM operation_jobs o JOIN projects p ON p.id=o.project_id JOIN users u ON u.id=o.created_by JOIN project_members m ON m.user_id=u.id AND m.project_id=p.id WHERE o.id=$1",[id]);
    const o=rows[0];if(!o||o.kind!=='planning'||o.status!=='running'||o.project_status==='archived'||o.disabled||o.creator_kind!=='human'||!['owner','editor'].includes(o.role)||o.version!==o.input.base_project_version||operationContextHash(o)!==o.context_hash)throw new Error('AI_OPERATION_INVALID');
  };
  const server=budgetServer({db,otherDb,mode,authorized,verifyOperation});server.requestTimeout=15000;
  server.listen(23083,'127.0.0.1',()=>console.log(`G3 AI budget guard on loopback 23083; mode=${mode}; authorization required`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{db.close();otherDb?.close();await pool.end()}));
}
