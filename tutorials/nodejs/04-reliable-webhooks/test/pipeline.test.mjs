import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {MediaRuntime} from '@mediaruntime/node';
import {createReceiver} from '../src/server.mjs';
import {processOne} from '../src/process-inbox.mjs';
const url=new URL(process.env.TEST_DATABASE_URL||'postgresql://invalid/invalid');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('TEST_DATABASE_URL must point to a loopback database ending in _test.');
const pool=new pg.Pool({connectionString:url.href,max:12});
const root=path.resolve(process.env.TEST_MEDIA_ROOT||'./var/test-media');
const account='acc_test',secret='test-only-secret';
const media=new MediaRuntime({apiKey:'test-only',webhookSecret:secret});
let server,endpoint;
const event=(id='evt_1',job='job_test')=>({event_id:id,account_id:account,job_id:job,status:'COMPLETED'});
function sign(body,id,seconds=0){const timestamp=String(Math.floor(Date.now()/1000)+seconds);const sig=createHmac('sha256',secret).update(`${timestamp}.${id}.`).update(body).digest('hex');return {'Content-Type':'application/json','X-Transcoder-Id':id,'X-Transcoder-Timestamp':timestamp,'X-Transcoder-Signature':`t=${timestamp},v1=${sig}`};}
async function post(data,options={}){const body=JSON.stringify(data);return fetch(endpoint,{method:'POST',headers:sign(body,data.event_id,options.offset||0),body:options.mutate?body+' ':body});}
async function video(job='job_test'){const id=randomUUID();await pool.query("INSERT INTO videos(id,name,remote_job_id,state) VALUES($1,'Bunny', $2,'processing')",[id,job]);return id;}
async function save(_job,directory){await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'result.mp4'),'test fixture bytes');}
const worker=(overrides={})=>processOne({pool,root,media:{jobs:{get:async()=>({status:'COMPLETED',bundle:{}})}},saveResult:save,baseDelay:0,...overrides});
before(async()=>{await pool.query(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));server=createReceiver({pool,media,accountId:account}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));endpoint=`http://127.0.0.1:${server.address().port}/webhooks/mediaruntime`;await mkdir(root,{recursive:true});});
beforeEach(async()=>{await pool.query('TRUNCATE videos,webhook_inbox,pipeline_log RESTART IDENTITY');});
after(async()=>{await new Promise(r=>server.close(r));await pool.end();await rm(root,{recursive:true,force:true});});
test('SDK verifies original bytes; mutation and stale timestamps are rejected',async()=>{
 assert.equal((await post(event(),{mutate:true})).status,401);assert.equal((await post(event(),{offset:-600})).status,401);
 assert.equal((await pool.query('SELECT * FROM webhook_inbox')).rowCount,0);
 assert.equal((await post(event())).status,204);assert.equal((await pool.query('SELECT * FROM webhook_inbox')).rowCount,1);
});
test('wrong account and unsupported event are not enqueued',async()=>{
 assert.equal((await post({...event(),account_id:'acc_other'})).status,403);
 assert.equal((await post({...event(),status:'PROCESSING'})).status,400);
 assert.equal((await pool.query('SELECT * FROM webhook_inbox')).rowCount,0);
});
test('concurrent duplicate deliveries create exactly one PostgreSQL event',async()=>{
 const responses=await Promise.all(Array.from({length:16},()=>post(event())));assert.ok(responses.every(r=>r.status===204));
 const rows=(await pool.query('SELECT * FROM webhook_inbox')).rows;assert.equal(rows.length,1);assert.equal(rows[0].deliveries,16);
});
test('same event ID cannot be rebound to another job',async()=>{
 await post(event());assert.equal((await post(event('evt_1','job_other'))).status,409);
 assert.equal((await pool.query('SELECT job_id FROM webhook_inbox')).rows[0].job_id,'job_test');
});
test('database failure returns 503 rather than acknowledging a lost event',async()=>{
 const bad=createReceiver({pool:{query:async()=>{throw Error('offline');}},media,accountId:account}).listen(0,'127.0.0.1');await new Promise(r=>bad.once('listening',r));
 try{const body=JSON.stringify(event());const res=await fetch(`http://127.0.0.1:${bad.address().port}/webhooks/mediaruntime`,{method:'POST',headers:sign(body,'evt_1'),body});assert.equal(res.status,503);}finally{await new Promise(r=>bad.close(r));}
});
test('multiple workers claim one event and commit one completion',async()=>{
 await video();await post(event());let saves=0;
 await Promise.all(Array.from({length:5},()=>worker({saveResult:async(...args)=>{saves++;await new Promise(r=>setTimeout(r,70));await save(...args);}})));
 assert.equal(saves,1);assert.equal((await pool.query('SELECT completion_count FROM videos')).rows[0].completion_count,1);
});
test('two event IDs for the same job still save one completion',async()=>{
 await video();await post(event('evt_a'));await post(event('evt_b'));let saves=0;
 await Promise.all([worker({saveResult:async(...a)=>{saves++;await save(...a);}}),worker({saveResult:async(...a)=>{saves++;await save(...a);}})]);
 assert.equal(saves,1);assert.equal((await pool.query("SELECT * FROM webhook_inbox WHERE state='done'")).rowCount,2);
});
test('worker failure persists; a fresh worker resumes the same event',async()=>{
 await video();await post(event());await worker({failOnce:()=>true});let row=(await pool.query('SELECT * FROM webhook_inbox')).rows[0];
 assert.equal(row.state,'pending');assert.equal(row.attempts,1);assert.match(row.last_error,/simulated/);
 await worker();row=(await pool.query('SELECT * FROM webhook_inbox')).rows[0];assert.equal(row.state,'done');assert.equal(row.attempts,2);
});
test('file saved before transaction failure is retried without duplicate DB completion',async()=>{
 await video();await post(event());await worker({saveResult:async(...a)=>{await save(...a);throw Error('lost commit');}});
 assert.equal((await pool.query('SELECT completion_count FROM videos')).rows[0].completion_count,0);
 await worker();assert.equal((await pool.query('SELECT completion_count FROM videos')).rows[0].completion_count,1);
});
test('retry delay is scheduled and maximum attempts produce dead letter',async()=>{
 await video();await post(event());await worker({failOnce:()=>true,baseDelay:60,maxAttempts:2});
 assert.equal(await worker(),false);await pool.query("UPDATE webhook_inbox SET next_attempt_at=now()");
 await worker({failOnce:()=>true,maxAttempts:2});assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'dead');assert.equal(await worker(),false);
});
test('callback before local job mapping is durably retried',async()=>{
 await post(event());await worker();assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'pending');
 await video();await worker();assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'done');
});
test('failed remote job has no playable output and completes its event',async()=>{
 await video();await post({...event(),status:'FAILED'});await worker({media:{jobs:{get:async()=>({status:'FAILED'})}}});
 assert.equal((await pool.query('SELECT state FROM videos')).rows[0].state,'failed');assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'done');
});
