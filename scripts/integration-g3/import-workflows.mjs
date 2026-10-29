import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {root,secrets} from './runtime.mjs';
const folder=root+'/.g3/workflows';await mkdir(folder,{recursive:true});
for(const file of await readdir(root+'/automation/n8n/workflows')){
 const w=JSON.parse(await readFile(root+'/automation/n8n/workflows/'+file,'utf8'));
 // Compile an explicit fixture profile: no credential-bearing AI nodes can run.
 const remove=new Set(w.nodes.filter(n=>n.type.includes('langchain')).map(n=>n.name));
 w.nodes=w.nodes.filter(n=>!remove.has(n.name));
 for(const [name,connections] of Object.entries(w.connections)){
  if(remove.has(name)){delete w.connections[name];continue;}
  for(const outputs of Object.values(connections))for(let i=0;i<outputs.length;i++)outputs[i]=outputs[i].filter(link=>!remove.has(link.node));
 }
 await writeFile(folder+'/'+file,JSON.stringify(w,null,2));
}
const args=['compose','--env-file','.g3/runtime.env','-f','infra/integration-g3/compose.yaml'];
await writeFile(root+'/.g3/n8n-auth.json',JSON.stringify([{id:'G3WebhookAuth001',name:'G3 isolated webhook bearer',type:'httpHeaderAuth',data:{name:'Authorization',value:'Bearer '+secrets.G3_WEBHOOK_TOKEN}}]),{mode:0o600});
for(const tail of [['cp','.g3/n8n-auth.json','n8n:/tmp/g3-auth.json'],['exec','-T','-u','root','n8n','chown','node:node','/tmp/g3-auth.json'],['exec','-T','n8n','n8n','import:credentials','--input=/tmp/g3-auth.json'],['exec','-T','n8n','rm','-f','/tmp/g3-auth.json'],['cp','.g3/workflows/.','n8n:/tmp/g3-fixture-workflows'],['exec','-T','n8n','n8n','import:workflow','--separate','--input=/tmp/g3-fixture-workflows'],['exec','-T','n8n','n8n','update:workflow','--all','--active=true'],['restart','n8n']]){
 const r=spawnSync('docker',[...args,...tail],{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
}
