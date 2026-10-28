import {readFile} from 'node:fs/promises';
import {MediaRuntime} from '@mediaruntime/node';

// Explicit one-time account mutation, never invoked by the upload pipeline.
const [file,ack]=process.argv.slice(2);
if (!file || ack !== '--replace-account-logo') {
  console.error('Usage: npm run logo -- /path/to/logo.png --replace-account-logo');
  console.error('Replaces the account-wide logo and defaults for future watermarked jobs. Use a dedicated test account.');
  process.exit(1);
}
const bytes=await readFile(file);
if (bytes.length>2*1024*1024 || bytes.length<24 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
  throw new Error('Choose a PNG up to 2 MB.');
const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
if (!width || !height || width>4096 || height>4096) throw new Error('PNG dimensions must be 1–4096 pixels.');
const media=new MediaRuntime();
try {
  const result=await media.watermarkLogo.upload(file, {position:'bottom_right',opacityPct:90,scalePct:24});
  console.log(JSON.stringify({configured:true,position:result.position,opacityPct:result.opacityPct,scalePct:result.scalePct}));
} catch (error) { console.error('Logo setup failed:',error.name,error.status??'',error.requestId??''); process.exitCode=1; }
