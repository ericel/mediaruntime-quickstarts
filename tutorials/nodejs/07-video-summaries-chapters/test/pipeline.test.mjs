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
async function recording(job='job_test'){const id=randomUUID();await pool.query("INSERT INTO recordings(id,name,remote_job_id,state) VALUES($1,'Speech fixture', $2,'processing')",[id,job]);return id;}
async function save(_job,directory){await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'result.m4a'),'test fixture bytes');await writeFile(path.join(directory,'transcript.vtt'),'WEBVTT\n\n00:00.000 --> 00:01.500\nSynthetic test cue.\n');}
const worker=(overrides={})=>processOne({pool,root,media:{jobs:{get:async()=>({status:'COMPLETED',bundle:{}})}},saveResult:save,baseDelay:0,...overrides});
before(async()=>{await pool.query(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));server=createReceiver({pool,media,accountId:account}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));endpoint=`http://127.0.0.1:${server.address().port}/webhooks/mediaruntime`;await mkdir(root,{recursive:true});});
beforeEach(async()=>{await pool.query('TRUNCATE recordings,webhook_inbox,pipeline_log RESTART IDENTITY');});
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
 await recording();await post(event());let saves=0;
 await Promise.all(Array.from({length:5},()=>worker({saveResult:async(...args)=>{saves++;await new Promise(r=>setTimeout(r,70));await save(...args);}})));
 assert.equal(saves,1);assert.equal((await pool.query('SELECT completion_count FROM recordings')).rows[0].completion_count,1);
});
test('two event IDs for the same job still save one completion',async()=>{
 await recording();await post(event('evt_a'));await post(event('evt_b'));let saves=0;
 await Promise.all([worker({saveResult:async(...a)=>{saves++;await save(...a);}}),worker({saveResult:async(...a)=>{saves++;await save(...a);}})]);
 assert.equal(saves,1);assert.equal((await pool.query("SELECT * FROM webhook_inbox WHERE state='done'")).rowCount,2);
});
test('worker failure persists; a fresh worker resumes the same event',async()=>{
 await recording();await post(event());await worker({failOnce:()=>true});let row=(await pool.query('SELECT * FROM webhook_inbox')).rows[0];
 assert.equal(row.state,'pending');assert.equal(row.attempts,1);assert.match(row.last_error,/simulated/);
 await worker();row=(await pool.query('SELECT * FROM webhook_inbox')).rows[0];assert.equal(row.state,'done');assert.equal(row.attempts,2);
});
test('file saved before transaction failure is retried without duplicate DB completion',async()=>{
 await recording();await post(event());await worker({saveResult:async(...a)=>{await save(...a);throw Error('lost commit');}});
 assert.equal((await pool.query('SELECT completion_count FROM recordings')).rows[0].completion_count,0);
 await worker();assert.equal((await pool.query('SELECT completion_count FROM recordings')).rows[0].completion_count,1);
});
test('retry delay is scheduled and maximum attempts produce dead letter',async()=>{
 await recording();await post(event());await worker({failOnce:()=>true,baseDelay:60,maxAttempts:2});
 assert.equal(await worker(),false);await pool.query("UPDATE webhook_inbox SET next_attempt_at=now()");
 await worker({failOnce:()=>true,maxAttempts:2});assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'dead');assert.equal(await worker(),false);
});
test('callback before local job mapping is durably retried',async()=>{
 await post(event());await worker();assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'pending');
 await recording();await worker();assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'done');
});
test('failed remote job has no playable output and completes its event',async()=>{
 await recording();await post({...event(),status:'FAILED'});await worker({media:{jobs:{get:async()=>({status:'FAILED'})}}});
 assert.equal((await pool.query('SELECT state FROM recordings')).rows[0].state,'failed');assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'done');
});

test('submission retry reuses durable source and idempotency key',async()=>{
 const {submitOne}=await import('../src/submit.mjs');const id=randomUUID();await pool.query("INSERT INTO recordings(id,name,state) VALUES($1,'speech.mp4','queued')",[id]);let uploads=0;const keys=[];
 const client={uploads:{uploadFile:async()=>{uploads++;return{fileUri:'gs://test/input.mp4'};}},jobs:{create:async p=>{keys.push(p.idempotencyKey);if(keys.length===1)throw Error('connection lost after request');return{id:'job_retry'};}}};
 await submitOne({pool,media:client,root});await pool.query('UPDATE recordings SET submit_retry_at=now()');await submitOne({pool,media:client,root});
 assert.equal(uploads,1);assert.deepEqual(keys,[`node-chapters:${id}`,`node-chapters:${id}`]);assert.equal((await pool.query('SELECT remote_job_id FROM recordings')).rows[0].remote_job_id,'job_retry');
});
test('competing submitters create only one remote job for a saved recording',async()=>{
 const {submitOne}=await import('../src/submit.mjs');const id=randomUUID();await pool.query("INSERT INTO recordings(id,name,state,source_uri) VALUES($1,'speech.mp4','queued','gs://test/input.mp4')",[id]);let submissions=0;
 const client={jobs:{create:async()=>{submissions++;await new Promise(r=>setTimeout(r,60));return{id:'job_once'};}}};await Promise.all([submitOne({pool,media:client,root}),submitOne({pool,media:client,root})]);assert.equal(submissions,1);
});
test('completed transcript is saved as timed cues and derived plain text',async()=>{
 const id=await recording();await post(event());await worker();const row=(await pool.query('SELECT cues FROM recordings')).rows[0];assert.deepEqual(row.cues,[{start:0,end:1.5,text:'Synthetic test cue.'}]);assert.equal(await readFile(path.join(root,id,'transcript.txt'),'utf8'),'Synthetic test cue.\n');
});
test('malformed downloaded transcript never becomes ready',async()=>{
 await recording();await post(event());await worker({saveResult:async(job,dir)=>{await save(job,dir);await writeFile(path.join(dir,'transcript.vtt'),'not captions');}});const row=(await pool.query('SELECT state FROM recordings')).rows[0];assert.equal(row.state,'processing');assert.equal((await pool.query('SELECT state FROM webhook_inbox')).rows[0].state,'pending');
});

async function chapterRecording(){const id=await recording();await pool.query("UPDATE recordings SET state='ready',duration=90,cues=$2,chapter_state='queued',completion_count=1 WHERE id=$1",[id,JSON.stringify(Array.from({length:6},(_,i)=>({start:i*15,end:i*15+14,text:`Topic ${i}`})))]);return id;}
function draftResult(){return{draft:{summary:'A reviewed summary of the three topics in this original video.',evidenceCueIds:[0,2,4],chapters:[{cueId:0,title:'First topic',start:0},{cueId:2,title:'Second topic',start:30},{cueId:4,title:'Third topic',start:60}]},provenance:{model:'fixture'}};}
test('model failure retries from saved transcript without changing remote job or completion',async()=>{const {processChapters}=await import('../src/process-chapters.mjs');const id=await chapterRecording();await processChapters({pool,generate:async()=>{throw Error('timeout');},baseDelay:0});let row=(await pool.query('SELECT * FROM recordings WHERE id=$1',[id])).rows[0];assert.equal(row.state,'ready');assert.equal(row.chapter_state,'queued');assert.equal(row.chapter_attempts,1);await processChapters({pool,generate:async()=>draftResult()});row=(await pool.query('SELECT * FROM recordings WHERE id=$1',[id])).rows[0];assert.equal(row.chapter_state,'review');assert.equal(row.completion_count,1);assert.equal(row.remote_job_id,'job_test');assert.equal(row.chapter_attempts,2);});
test('competing model workers produce one draft',async()=>{const {processChapters}=await import('../src/process-chapters.mjs');await chapterRecording();let calls=0;const generate=async()=>{calls++;await new Promise(r=>setTimeout(r,30));return draftResult();};await Promise.all([processChapters({pool,generate}),processChapters({pool,generate})]);assert.equal(calls,1);});
test('model retries stop after three attempts including a crashed generating state',async()=>{const {processChapters}=await import('../src/process-chapters.mjs');const id=await chapterRecording();await pool.query("UPDATE recordings SET chapter_state='generating',chapter_attempts=3 WHERE id=$1",[id]);let calls=0;await processChapters({pool,generate:async()=>{calls++;return draftResult();}});assert.equal(calls,0);assert.equal((await pool.query('SELECT chapter_state FROM recordings')).rows[0].chapter_state,'failed');});
test('review gates exports, rejects invalid timing, and prevents stale overwrite',async()=>{
 const {createDashboard}=await import('../src/server.mjs');const id=await chapterRecording();const draft=draftResult().draft;
 await pool.query("UPDATE recordings SET chapter_state='review',draft=$2,revision=1 WHERE id=$1",[id,JSON.stringify(draft)]);
 const http=await import('node:http');const srv=http.createServer();await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;srv.on('request',createDashboard({pool,root,port}));const base=`http://127.0.0.1:${port}`;
 const body={revision:1,draft:{...draft,chapters:draft.chapters.map(({cueId,title})=>({cueId,title}))}};
 const put=data=>fetch(base+`/api/recordings/${id}/review`,{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
 assert.equal((await fetch(base+`/api/recordings/${id}/export/txt`)).status,409);
 assert.equal((await put({...body,draft:{...body.draft,chapters:body.draft.chapters.slice(0,2)}})).status,400);
 assert.equal((await put(body)).status,200);assert.equal((await put(body)).status,409);
 const exported=await fetch(base+`/api/recordings/${id}/export/txt`);assert.equal(exported.status,200);assert.match(await exported.text(),/00:30 Second topic/);
 assert.equal((await fetch(base+`/api/recordings/${id}/review`,{method:'PUT',headers:{Origin:'https://example.org','Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
 }finally{await new Promise(r=>srv.close(r));}
});
