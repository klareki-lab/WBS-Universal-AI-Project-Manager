/** Run only in the ephemeral G4 runner against its pinned G3 database; no provider calls. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const backend=process.env.UAPM_G4_BACKEND_DIR;
if(!backend||!process.env.DATABASE_URL)throw new Error('Isolated G4 database configuration required');
const require=createRequire(backend+'/package.json');const {Pool}=require('pg');const db=new Pool({connectionString:process.env.DATABASE_URL});
try{
 const evidence=JSON.parse(await readFile('qa-evidence/g4-real-evidence.json','utf8'));assert.equal(evidence.projects.length,3);assert.equal(evidence.providerCalls,0);
 for(const expected of evidence.projects){const r=await db.query('SELECT name,description FROM projects WHERE id=$1',[expected.id]);assert.equal(r.rows[0].name,expected.name);assert.equal(r.rows[0].description,expected.description);assert.deepEqual(Buffer.from(r.rows[0].description,'utf8'),Buffer.from(expected.description,'utf8'));}
 const jobs=await db.query("SELECT count(*)::int AS count FROM operation_jobs WHERE kind='planning'");assert.equal(jobs.rows[0].count,0);
 const report={source:'unmodified G3 backend + real ephemeral PostgreSQL',projectRowsVerified:evidence.projects.length,unicodeByteEquality:true,planningOperations:0,providerCalls:0,checks:evidence.checks};
 await writeFile('qa-evidence/g4-postgresql-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await db.end();}
