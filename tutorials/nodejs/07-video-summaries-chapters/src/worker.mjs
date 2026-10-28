import { setTimeout } from 'node:timers/promises';
import { config } from './config.mjs';
import { processOne } from './process-inbox.mjs';
import { submitOne } from './submit.mjs';
import { processChapters } from './process-chapters.mjs';
const c=config(); let stopped=false,simulate=process.argv.includes('--demo-fail-once');
process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
console.log(`Inbox worker started${simulate?' — controlled one-time failure demonstration':''}`);
while (!stopped) {
  try { await submitOne(c); await processOne({...c,failOnce:()=>{const value=simulate;simulate=false;return value;}}); }
  catch { console.error('Database unavailable; worker will reconnect.'); }
  try { await processChapters(c); } catch { console.error('Chapter worker will reconnect.'); }
  await setTimeout(1000);
}
await c.pool.end();
