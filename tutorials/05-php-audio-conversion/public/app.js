const form=document.querySelector('#upload');
form.addEventListener('submit',async event=>{
 event.preventDefault();const button=form.querySelector('button');button.disabled=true;
 try{const response=await fetch('upload.php',{method:'POST',body:new FormData(form)});const data=await response.json();if(!response.ok)throw new Error(data.error);location.reload();}
 catch(error){document.querySelector('#feedback').textContent=error.message;button.disabled=false;}
});
function attachPlayer(card){
 const audio=card.querySelector('audio'),canvas=card.querySelector('canvas'),ctx=canvas.getContext('2d');let analyser,buffer,ac;
 const time=value=>Math.floor(value/60)+':'+String(Math.floor(value%60)).padStart(2,'0');
 function draw(){ctx.clearRect(0,0,800,140);ctx.strokeStyle='#dbf07b';ctx.lineWidth=2;ctx.beginPath();
  if(analyser)analyser.getByteTimeDomainData(buffer);
  for(let x=0;x<800;x++){const y=buffer?70+(buffer[Math.floor(x*buffer.length/800)]-128)*.8:70;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();requestAnimationFrame(draw);}
 audio.addEventListener('play',()=>{if(!ac){ac=new AudioContext();analyser=ac.createAnalyser();analyser.fftSize=2048;buffer=new Uint8Array(analyser.fftSize);const source=ac.createMediaElementSource(audio);source.connect(analyser);analyser.connect(ac.destination);}ac.resume();card.querySelector('.playback').textContent='Playing your saved M4A from application storage.';});
 audio.addEventListener('timeupdate',()=>card.querySelector('.clock').textContent=time(audio.currentTime)+' / '+time(Number.isFinite(audio.duration)?audio.duration:0));
 audio.addEventListener('ended',()=>card.querySelector('.playback').textContent='Playback complete. Your saved copy is ready to reuse.');
 audio.addEventListener('error',()=>card.querySelector('.playback').textContent='Playback failed. Download the file and inspect the result.');draw();
}
document.querySelectorAll('article[data-id]').forEach(card=>{
 async function poll(){try{
  const response=await fetch('status.php?id='+card.dataset.id);if(!response.ok)throw new Error('Status unavailable. Refresh to retry.');const data=await response.json();card.querySelector('.status').textContent=data.status;
  if(data.status==='failed'){card.querySelector('.message').textContent=data.error;return;}
  if(data.status!=='ready'){card.querySelector('.message').textContent='Processing remotely. The worker will save your converted audio.';setTimeout(poll,2000);return;}
  card.querySelector('.message').textContent='Converted with audio.web • Saved in your application storage';
  card.querySelector('.player').hidden=false;card.querySelector('audio').src=data.media_url;card.querySelector('.details').hidden=false;
  const kb=n=>(n/1024).toFixed(1)+' KB';card.querySelector('.sizes').textContent=kb(data.input_bytes)+' WAV → '+kb(data.audio.bytes)+' M4A';card.querySelector('a').href=data.media_url+'&download=1';attachPlayer(card);
 }catch(error){card.querySelector('.message').textContent=error.message;}}poll();
});
