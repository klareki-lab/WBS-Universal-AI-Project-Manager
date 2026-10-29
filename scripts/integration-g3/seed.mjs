import {secrets,database,root} from './runtime.mjs';
const {default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');
const {passwordHash,hash}=await import(root+'/apps/backend/dist/apps/backend/src/security.js');
const pool=new pg.Pool({connectionString:database});
try {
 for(const [email,name] of [['g3-owner@example.invalid','SYNTHETISCH G3 Owner'],['g3-outsider@example.invalid','SYNTHETISCH G3 Outsider']]) await pool.query("INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,$2,'human',$3) ON CONFLICT(email) DO NOTHING",[email,name,await passwordHash(secrets.G3_HUMAN_PASSWORD)]);
 await pool.query("INSERT INTO users(id,email,display_name,kind,token_hash,scopes,token_expires_at) VALUES($3,'g3-planner@service.invalid','SYNTHETISCH G3 planner','service',$1,$2,now()+interval '1 day') ON CONFLICT(email) DO UPDATE SET token_hash=EXCLUDED.token_hash",[hash(secrets.G3_BACKEND_TOKEN),['read','plans:write','operations:write','plans:publish'],secrets.G3_SERVICE_ID]);
 if(process.argv[2]){const project=process.argv[2];if(!/^[0-9a-f-]{36}$/.test(project))throw new Error('Project UUID required');await pool.query("INSERT INTO project_members(project_id,user_id,role) SELECT $1,id,'editor' FROM users WHERE email='g3-planner@service.invalid' ON CONFLICT DO NOTHING",[project]);console.log('Enrolled synthetic project in isolated G3 service scope');}
 else console.log('Synthetic G3 identities ready; password stays in ignored .g3/runtime.env');
} finally {await pool.end();}
