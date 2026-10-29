import {env,secrets,root} from './runtime.mjs';
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const r=spawnSync('npm',['test'],{cwd:root+'/apps/backend',env:{...env,TEST_DATABASE_URL:`postgresql://uapm:${secrets.G3_DB_PASSWORD}@localhost:25439/uapm_test`},encoding:'utf8'});
await writeFile(root+'/docs/integration-g3/evidence/backend-tests.log',r.stdout+r.stderr);
console.log('Backend suite exit',r.status);process.exitCode=r.status??1;
