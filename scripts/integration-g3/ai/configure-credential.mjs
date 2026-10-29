import {writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {root} from './compile.mjs';
// Owner supplies a sandbox-only key over hidden terminal input or stdin.
// No command argument, environment variable, output or Git file contains the key.
let apiKey='';
if(process.stdin.isTTY){
 process.stderr.write('Sandbox-only OpenAI API key (hidden; no provider call): ');
 const mute=new Writable({write(chunk,encoding,callback){callback()}});
 const rl=createInterface({input:process.stdin,output:mute,terminal:true});
 apiKey=await new Promise(resolve=>rl.question('',resolve));rl.close();process.stderr.write('\n');
}else{for await(const chunk of process.stdin){apiKey+=chunk;if(apiKey.length>1000)throw new Error('Invalid credential input')}}
apiKey=apiKey.trim();if(!/^sk-\S+$/.test(apiKey)||apiKey.length>1000)throw new Error('Expected a sandbox OpenAI API key');
const path=root+'/.g3/openai-import.json';
const args=['compose','--env-file','.g3/runtime.env','-f','infra/integration-g3/compose.yaml'];
function docker(tail){const r=spawnSync('docker',[...args,...tail],{cwd:root,stdio:'pipe'});if(r.status!==0)throw new Error('Isolated credential import failed; no provider call made. Raw output withheld to protect credentials.');}
let created=false,copied=false;
try{
 await writeFile(path,JSON.stringify([{id:'uapm-openai',name:'UAPM OpenAI (G3 sandbox only)',type:'openAiApi',data:{apiKey,url:'http://host.docker.internal:23083/DENY'}}]),{mode:0o600,flag:'wx'});created=true;
 docker(['cp','.g3/openai-import.json','n8n:/tmp/g3-openai-import.json']);copied=true;
 docker(['exec','-T','-u','root','n8n','chown','node:node','/tmp/g3-openai-import.json']);
 docker(['exec','-T','n8n','n8n','import:credentials','--input=/tmp/g3-openai-import.json']);
 console.log('Sandbox credential encrypted in dedicated G3 n8n as uapm-openai; no provider call made');
}finally{
 apiKey='';
 try{if(copied)docker(['exec','-T','-u','root','n8n','rm','-f','/tmp/g3-openai-import.json'])}finally{if(created)await unlink(path).catch(()=>{})}
}
