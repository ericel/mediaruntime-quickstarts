const $=id=>document.getElementById(id);let id,timer;
const labels={queued:'Queued',uploading:'Uploading with SDK',submitting:'Submitting Premium job',processing:'Applying watermark',waiting:'Reconnecting to the same job',saving:'Saving processed MP4',ready:'SAVED · READY TO PLAY',failed:'Needs attention'};
function render(r){id=r.id;const ready=r.status==='ready';$('badge').textContent=labels[r.status]||r.status;$('badge').className=ready?'ready':'';$('job-error').textContent=r.error||'';
 if($('source').getAttribute('src')!==r.sourceUrl)$('source').src=r.sourceUrl;
 if(ready){if($('player').getAttribute('src')!==r.mediaUrl)$('player').src=r.mediaUrl;$('download').href=r.mediaUrl;$('sizes').textContent=`SOURCE ${Math.round(r.sourceBytes/1024)} KB · OUTPUT ${Math.round(r.outputBytes/1024)} KB`;}
 $('download').hidden=!ready;$('play').disabled=!ready;$('seek').disabled=!ready;$('job-id').textContent=r.jobId?`JOB ${r.jobId} · saved locally`:'';
 clearTimeout(timer);if(!ready&&r.status!=='failed')timer=setTimeout(poll,1200);
}
async function poll(){try{const x=await fetch(`/api/videos/${id}`);if(!x.ok)throw Error();render(await x.json());}catch{$('job-error').textContent='Local server unavailable. Reconnecting…';timer=setTimeout(poll,3000);}}
$('upload').addEventListener('submit',async e=>{e.preventDefault();$('submit').disabled=true;$('form-error').textContent='';try{const x=await fetch('/api/videos',{method:'POST',body:new FormData(e.currentTarget)});const r=await x.json();if(!x.ok)throw Error(r.error);render(r);}catch(e){$('form-error').textContent=e.message;}finally{$('submit').disabled=false;}});
$('play').onclick=async()=>{try{for(const v of [$('source'),$('player')])v.currentTime=0;await Promise.all([$('source').play(),$('player').play()]);}catch{$('job-error').textContent='Use the video controls to play.';}};
$('seek').onclick=()=>{const t=Math.min($('source').duration,$('player').duration)/2;for(const v of [$('source'),$('player')])v.currentTime=t;};
fetch('/api/videos').then(r=>{if(!r.ok)throw Error();return r.json();}).then(rows=>{if(rows[0])render(rows[0]);}).catch(()=>{$('form-error').textContent='Cannot load saved videos.';});

let preview;
$('logo').onchange=()=>{if(preview)URL.revokeObjectURL(preview);const f=$('logo').files[0];$('logo-preview').hidden=!f;if(f){preview=URL.createObjectURL(f);$('logo-preview').src=preview;}};
for(const k of ['opacity','scale'])$(k).oninput=()=>$(k+'-value').textContent=$(k).value+'%';
function logoStatus(x){if(x.configured)$('logo-status').textContent=`Last saved here: ${x.position.replaceAll('_',' ')} · ${x.opacityPct}% opacity · ${x.scalePct}% width`;}
$('logo-form').onsubmit=async e=>{e.preventDefault();$('save-logo').disabled=true;$('logo-error').textContent='';try{const x=await fetch('/api/watermark',{method:'POST',body:new FormData(e.currentTarget)});const body=await x.json();if(!x.ok)throw Error(body.error);logoStatus(body);$('logo-error').textContent='Account watermark saved. Ready for new jobs.';}catch(e){$('logo-error').textContent=e.message;}finally{$('save-logo').disabled=false;}};
fetch('/api/watermark').then(r=>r.json()).then(logoStatus).catch(()=>{});
