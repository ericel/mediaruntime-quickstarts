const el=id=>document.getElementById(id);let record=null,rendered='';
const stamp=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
function updateActive(){const t=el('player').currentTime;text('clock',stamp(t));for(const [i,b] of [...el('cues').querySelectorAll('button')].entries()){const cue=record.cues[i];b.setAttribute('aria-current',String(t>=cue.start&&t<cue.end));}}
const text=(id,value)=>el(id).textContent=value;
function search(){let n=0;for(const b of el('cues').querySelectorAll('button')){b.hidden=!b.textContent.toLowerCase().includes(el('search').value.toLowerCase());if(!b.hidden)n++;}el('empty').hidden=n>0;text('empty',record?.cues?.length?'No matching transcript segments.':'No speech segments were returned for this recording.');}
async function refresh(){const response=await fetch('/api/state');if(!response.ok)throw Error('Local service unavailable.');const s=await response.json();const row=s.recordings[0];if(!row)return;record=row;text('status',row.state);text('name',row.name);text('count',row.cues?.length||0);text('events',s.inbox.length);if(row.submit_error)text('message',row.submit_error);
 if(row.state==='ready'){
  el('play').disabled=false;el('downloads').hidden=false;
  if(rendered!==row.id){el('player').src=`/files/${row.id}/audio`;el('cues').replaceChildren();for(const cue of row.cues||[]){const b=document.createElement('button');b.type='button';b.className='cue';const time=document.createElement('span');time.textContent=`${stamp(cue.start)} → ${stamp(cue.end)}`;const words=document.createElement('div');words.textContent=cue.text;b.append(time,words);b.onclick=()=>{el('player').currentTime=cue.start;void el('player').play();};el('cues').append(b);}rendered=row.id;search();}
  for(const [id,kind]of[['m4a','audio'],['srt','srt'],['vtt','vtt'],['txt','text']])el(id).href=`/files/${row.id}/${kind}?download=1`;
 }else{el('play').disabled=true;el('downloads').hidden=true;if(rendered){el('player').pause();el('player').removeAttribute('src');el('player').load();el('cues').replaceChildren();rendered='';}}
}
el('upload').onsubmit=async e=>{e.preventDefault();const f=el('file').files[0];if(!f)return;el('submit').disabled=true;try{const body=new FormData();body.append('audio',f);const res=await fetch('/api/recordings',{method:'POST',body});const data=await res.json();if(!res.ok)throw Error(data.error);text('message','Saved upload. The worker will submit it and wait for the signed callback.');await refresh();}catch(e){text('message',e.message);}finally{el('submit').disabled=false;}};
el('play').onclick=()=>el('player').play();el('player').ontimeupdate=()=>{if(record?.cues)updateActive();};el('search').oninput=search;
refresh().catch(e=>text('message',e.message));setInterval(()=>refresh().catch(()=>{}),1000);
