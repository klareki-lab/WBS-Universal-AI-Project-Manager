import {writeFile} from 'node:fs/promises';
import {root,secrets} from './runtime.mjs';
const email='g3-owner@example.invalid',password=secrets.G3_HUMAN_PASSWORD.slice(0,30)+'Aa1!';
for(let i=0;i<30;i++){try{if((await fetch('http://localhost:25682/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,1000));}
const setup=await fetch('http://localhost:25682/rest/owner/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,firstName:'Synthetic',lastName:'G3',password})});
let cookie=setup.headers.get('set-cookie')?.split(';')[0];
if(!cookie){const login=await fetch('http://localhost:25682/rest/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,emailOrLdapLoginId:email,password})});if(!login.ok)throw new Error('Isolated G3 n8n login failed; no account reset attempted');cookie=login.headers.get('set-cookie')?.split(';')[0];}
if(!cookie)throw new Error('G3 n8n session cookie was not returned');
await writeFile(root+'/.g3/n8n-cookie',cookie,{mode:0o600});console.log('Isolated n8n session saved in ignored .g3; no credential disclosed');
