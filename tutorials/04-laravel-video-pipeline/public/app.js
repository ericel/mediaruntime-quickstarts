document.querySelectorAll('article[data-status-url]').forEach(card=>{
 const video=card.querySelector('video');
 video.addEventListener('timeupdate',()=>{card.querySelector('.playback-proof').textContent='Playing saved MP4 · '+video.currentTime.toFixed(1)+' / '+(Number.isFinite(video.duration)?video.duration.toFixed(1):'…')+' s';});
 async function poll(){try{
  const r=await fetch(card.dataset.statusUrl,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error('Refresh to check status.');const d=await r.json();
  card.querySelector('.status').textContent=d.status;
  card.querySelector('.callback').textContent=d.callback_received?'Webhook verified ✓':'Webhook awaiting';
  card.querySelector('.saved').textContent=d.status==='ready'?'Saved to '+d.disk+' ✓':'Storage pending';
  if(d.status==='failed'){card.querySelector('.message').textContent=d.error;return;}
  if(d.status==='ready'){
   card.querySelector('.message').textContent='Completed via '+d.completion_via+'. This player uses your saved copy.';
   if(!video.src)video.src=d.playback;video.hidden=false;card.querySelector('.details').hidden=false;card.querySelector('.open-video').href=d.playback;return;
  }
  card.querySelector('.message').textContent='The worker is processing your video. You can leave this page and return.';setTimeout(poll,2000);
 }catch(e){card.querySelector('.message').textContent=e.message;}}
 poll();
});