import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {root} from './runtime.mjs';
const dir=root+'/docs/integration-g3/evidence';await mkdir(root+'/.g3/raw-evidence',{recursive:true,mode:0o700});
const ids=new Map();let counter=0;
for(const file of (await readdir(dir)).filter(f=>f.endsWith('.json')).sort()){
 const path=dir+'/'+file,raw=await readFile(path,'utf8');
 if(!/^[{[]/.test(raw.trim()))continue;
 await writeFile(root+'/.g3/raw-evidence/'+file,raw,{mode:0o600});
 const redacted=raw.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,id=>{if(!ids.has(id))ids.set(id,'id-'+String(++counter).padStart(4,'0'));return ids.get(id)});
 await writeFile(path,redacted);
}
await writeFile(root+'/.g3/id-map.json',JSON.stringify(Object.fromEntries(ids)),{mode:0o600});
console.log('Redacted synthetic UUIDs consistently; originals/map remain only in ignored .g3');
