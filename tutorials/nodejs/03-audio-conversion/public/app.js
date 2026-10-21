const $ = id => document.getElementById(id);
let activeId, timer, previewUrl, context, analyser, samples;
const labels = {queued:'Queued', uploading:'Uploading your WAV', submitting:'Submitting the audio job', processing:'Converting to M4A', waiting:'Waiting to reconnect', saving:'Saving your M4A', ready:'SAVED TO YOUR DISK', failed:'Needs attention'};
const size = n => n >= 1024*1024 ? (n/1024/1024).toFixed(2)+' MB' : Math.round(n/1024)+' KB';
function render(r) {
 activeId=r.id;const ready=r.status==='ready';$('empty').hidden=true;$('progress').hidden=ready||r.status==='failed';$('result').hidden=!ready;
 $('badge').textContent=labels[r.status]||r.status;$('badge').className=ready?'badge ready':'badge';$('status-title').textContent=labels[r.status]||r.status;$('job-error').textContent=r.error||'';
 if(ready){if($('player').getAttribute('src')!==r.mediaUrl)$('player').src=r.mediaUrl;
 $('result-name').textContent=r.name;$('sizes').textContent=`${size(r.sourceBytes)} → ${size(r.outputBytes)}`;
 $('job-id').textContent=`JOB ${r.jobId} · served from your saved M4A`;$('download').href=r.mediaUrl+'?download=1';}
 clearTimeout(timer);if(!ready&&r.status!=='failed')timer=setTimeout(poll,1500);
}
async function poll(){try{const r=await fetch(`/api/audio/${activeId}`);if(!r.ok)throw Error();render(await r.json());}catch{$('job-error').textContent='Cannot reach the local server. Reconnecting…';timer=setTimeout(poll,3000);}}
$('audio').addEventListener('change',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);const f=$('audio').files[0];$('submit').disabled=true;$('form-error').textContent='';$('source').hidden=true;$('source').removeAttribute('src');$('source').load();$('filename').textContent=f?.name||'No file selected';if(!f)return;if(f.size>20*1024*1024){$('form-error').textContent='Choose a WAV up to 20 MB.';return;}previewUrl=URL.createObjectURL(f);$('source').src=previewUrl;$('source').hidden=false;$('submit').disabled=false;});
$('source').addEventListener('loadedmetadata',()=>{$('source-info').textContent=`${$('source').duration.toFixed(2)} seconds · ${size($('audio').files[0].size)} · original WAV`;});
$('source').addEventListener('error',()=>{$('source-info').textContent='Preview unavailable in this browser; remote processing may still support the WAV encoding.';});
$('upload').addEventListener('submit',async e=>{e.preventDefault();$('submit').disabled=true;$('form-error').textContent='';$('source').pause();$('player').pause();try{const r=await fetch('/api/audio',{method:'POST',body:new FormData(e.currentTarget)});const body=await r.json();if(!r.ok)throw Error(body.error);render(body);}catch(e){$('form-error').textContent=e.message||'Upload failed.';}finally{$('submit').disabled=false;}});
async function enableAudio(){if(!context){context=new AudioContext();analyser=context.createAnalyser();analyser.fftSize=256;samples=new Uint8Array(analyser.frequencyBinCount);context.createMediaElementSource($('player')).connect(analyser);analyser.connect(context.destination);}if(context.state==='suspended')await context.resume();}
$('play').addEventListener('click',async()=>{try{await enableAudio();if($('player').paused)await $('player').play();else $('player').pause();}catch{$('job-error').textContent='Playback could not start. Try the native audio controls.';}});
$('player').addEventListener('play',()=>{enableAudio().catch(()=>{});$('play').textContent='Pause audio Ⅱ';});$('player').addEventListener('pause',()=>{$('play').textContent='Play saved audio ▶';});
$('player').addEventListener('error',()=>{$('job-error').textContent='The saved audio could not be decoded. Check the browser and local file.';});
$('loop').addEventListener('change',()=>{$('player').loop=$('loop').checked;});
function draw(){const canvas=$('wave'),d=canvas.getContext('2d');d.clearRect(0,0,canvas.width,canvas.height);if(analyser)analyser.getByteFrequencyData(samples);for(let i=0;i<64;i++){const h=analyser&&!$('player').paused?Math.max(2,samples[i*2]/255*120):2;d.fillStyle=i<40?'#dbef85':'#b9a7ff';d.fillRect(i*12.5,125-h,8,h);}const t=Math.floor($('player').currentTime||0);$('clock').textContent=String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');requestAnimationFrame(draw);}draw();
fetch('/api/audio').then(r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(r[0])render(r[0]);}).catch(()=>{$('form-error').textContent='Cannot load saved audio. Check the local server.';});
