import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {root} from './compile.mjs';
const cookie=await readFile(root+'/.g3/n8n-cookie','utf8');
const get=async path=>{const r=await fetch('http://localhost:25682/rest/'+path,{headers:{cookie}});if(!r.ok)throw new Error('Isolated n8n evidence fetch failed');return(await r.json()).data};
function parseFlat(text){const table=JSON.parse(text),cache=new Map();function at(i){if(cache.has(i))return cache.get(i);const v=table[i];if(v===null||typeof v!=='object')return v;const o=Array.isArray(v)?[]:{};cache.set(i,o);for(const[k,x]of Object.entries(v))o[k]=typeof x==='string'?at(Number(x)):x;return o}return at(0)}
const credentials=await get('credentials'),workflows=[];
for(let i=1;i<=3;i++){
 const id=`G3AIWorkflow0000${i}`,w=await get('workflows/'+id),source=JSON.parse(await readFile(root+`/automation/n8n/ai-profile/${id}.json`,'utf8'));
 workflows.push({id,active:w.active,nodesMatchReviewedSource:JSON.stringify(w.nodes)===JSON.stringify(source.nodes),connectionsMatchReviewedSource:JSON.stringify(w.connections)===JSON.stringify(source.connections),sourceSha256:createHash('sha256').update(JSON.stringify(source)).digest('hex'),models:w.nodes.filter(n=>n.type.endsWith('.lmChatOpenAi')).map(n=>({name:n.name,type:n.type,version:n.typeVersion,credentialReference:n.credentials.openAiApi.id,parameters:n.parameters}))});
}
const {results}=await get('executions?limit=100'),executions=[];
for(const e of results.filter(e=>/^G3(AIWorkflow|MockAIWf)/.test(e.workflowId))){
 const d=await get('executions/'+e.id),data=parseFlat(d.data);
 executions.push({executionId:e.id,workflowId:e.workflowId,status:e.status,startedAt:e.startedAt,stoppedAt:e.stoppedAt,profile:e.workflowId.startsWith('G3Mock')?'MOCK PROVIDER ONLY':'native AI profile; credential missing',nodes:Object.entries(data.resultData.runData).map(([name,runs])=>({name,runs:runs.map(r=>({status:r.executionStatus,timeMs:r.executionTime,missingCredential:Boolean(r.error?.message?.includes('Credential with ID'))}))}))});
}
const db=new DatabaseSync(root+'/.g3/ai-budget.sqlite',{readOnly:true});const actualProviderReservations=db.prepare('SELECT count(*) n FROM calls').get().n;db.close();
await writeFile(root+'/docs/integration-g3/evidence/ai-profile.json',JSON.stringify({collectedAt:new Date().toISOString(),realAI:'NOT VERIFIED',credentialInventory:credentials.map(c=>({id:c.id,type:c.type,name:c.name})),workflows,executions,actualProviderReservations,paidCalls:actualProviderReservations===0?0:'NOT VERIFIED; inspect ledger and provider usage',expenseAuthorization:await readFile(root+'/.g3/ai-expense-authorization.json','utf8').then(s=>JSON.parse(s).authorized===true?'RECEIVED':'NOT RECEIVED').catch(()=>'NOT RECEIVED'),ownerRatification:'PENDING'},null,2)+'\n');
console.log('Collected redacted profile/missing-credential/mock-native execution evidence; no secrets or raw execution packets');
