const el=id=>document.getElementById(id),text=(id,s)=>el(id).textContent=s;
const stamp=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
let record=null, rendered='', revision=-1, draft=null, dirty=false;
function issues(){
 if(!draft)return [];
 const starts=draft.chapters.map((c,i)=>i===0?0:Math.floor(record.cues[c.cueId].start));
 const problems=[];
 if(starts.length<3)problems.push('Use at least three chapters.');
 if(draft.chapters[0]?.cueId!==0)problems.push('The first chapter must use segment 0.');
 starts.forEach((s,i)=>{if((starts[i+1]??Math.floor(record.duration))-s<10)problems.push(`Chapter ${i+1} is shorter than ten seconds.`);});
 return problems;
}
function changed(){dirty=true;text('badge','Unsaved review');text('issues',issues().join(' '));el('copy').disabled=true;el('export-text').hidden=el('export-json').hidden=el('export-preview').hidden=true;}
function seek(t){el('player').currentTime=t;el('player').play().catch(()=>text('message','Press play to resume video.'));}
function chapters(){
 el('chapters').replaceChildren();
 draft.chapters.forEach((c,i)=>{
  const row=document.createElement('div');row.className='chapter';
  const jump=document.createElement('button');jump.className='seek';jump.textContent=stamp(i===0?0:record.cues[c.cueId].start);jump.setAttribute('aria-label',`Seek to ${jump.textContent}`);jump.onclick=()=>seek(i===0?0:Math.floor(record.cues[c.cueId].start));
  const title=document.createElement('input');title.value=c.title;title.maxLength=90;title.setAttribute('aria-label',`Chapter ${i+1} title`);title.oninput=()=>{c.title=title.value;changed();};
  const remove=document.createElement('button');remove.textContent='×';remove.className='remove';remove.setAttribute('aria-label',`Remove chapter ${i+1}`);remove.disabled=i===0;remove.onclick=()=>{draft.chapters.splice(i,1);chapters();changed();};
  const select=document.createElement('select');select.setAttribute('aria-label',`Chapter ${i+1} source segment`);record.cues.forEach((cue,id)=>{const o=document.createElement('option');o.value=id;o.textContent=`#${id} · ${stamp(cue.start)} · ${cue.text.slice(0,65)}`;select.append(o);});select.value=c.cueId;select.disabled=i===0;select.onchange=()=>{c.cueId=Number(select.value);chapters();changed();};
  row.append(jump,title,remove,select);el('chapters').append(row);
 });
 text('issues',issues().join(' '));
}
function editor(row){
 if(!row.draft)return;
 draft={summary:row.draft.summary,evidenceCueIds:row.draft.evidenceCueIds,chapters:row.draft.chapters.map(({cueId,title})=>({cueId,title}))};
 revision=row.revision;dirty=false;el('summary').value=draft.summary;el('editor').hidden=false;el('waiting').hidden=true;text('badge',row.chapter_state==='approved'?'Reviewed':'AI draft · review needed');chapters();
 el('evidence').replaceChildren();for(const id of draft.evidenceCueIds){const b=document.createElement('button');b.textContent=`Source #${id}`;b.onclick=()=>seek(record.cues[id].start);el('evidence').append(b);}
 const approved=row.chapter_state==='approved';el('copy').disabled=!approved;el('export-text').hidden=el('export-json').hidden=el('export-preview').hidden=!approved;
 if(approved){el('export-text').href=`/api/recordings/${row.id}/export/txt`;el('export-json').href=`/api/recordings/${row.id}/export/json`;text('export-preview',row.draft.chapters.map(c=>`${stamp(c.start)} ${c.title}`).join('\n'));}
}
async function refresh(){
 const response=await fetch('/api/state');if(!response.ok)throw Error('Local service unavailable.');
 const state=await response.json(), row=state.recordings[0];if(!row)return;record=row;
 text('status',row.state);text('chapter-status',row.chapter_state);text('count',row.cues?.length||0);text('review-status',row.approved_at?'Reviewed':'Not reviewed');text('name',row.name);
 el('retry').hidden=row.chapter_state!=='failed';if(row.chapter_error)text('message',row.chapter_error);
 if(rendered!==row.id){rendered=row.id;revision=-1;draft=null;dirty=false;el('editor').hidden=true;el('waiting').hidden=false;el('player').removeAttribute('src');el('player').load();el('cues').replaceChildren();el('downloads').hidden=true;}
 if(row.state==='ready'&&!el('player').getAttribute('src')){
  el('player').src=`/files/${row.id}/video`;el('downloads').hidden=false;
  for(const [id,kind]of[['vtt','vtt'],['srt','srt'],['txt','text']])el(id).href=`/files/${row.id}/${kind}?download=1`;
  row.cues.forEach((cue,id)=>{const b=document.createElement('button');b.className='cue';b.dataset.id=id;const t=document.createElement('span');t.textContent=stamp(cue.start);b.append(t,document.createTextNode(cue.text));b.onclick=()=>seek(cue.start);el('cues').append(b);});
 }
 if(row.draft&&revision!==row.revision&&!dirty)editor(row);
}
el('upload').onsubmit=async e=>{e.preventDefault();el('submit').disabled=true;try{const body=new FormData();body.append('video',el('file').files[0]);const res=await fetch('/api/recordings',{method:'POST',body}),d=await res.json();if(!res.ok)throw Error(d.error);text('message','Upload saved. Waiting for transcription and the signed callback.');await refresh();}catch(e){text('message',e.message);}finally{el('submit').disabled=false;}};
el('player').ontimeupdate=()=>{text('clock',stamp(el('player').currentTime));for(const b of el('cues').children){const c=record.cues[Number(b.dataset.id)];b.setAttribute('aria-current',String(el('player').currentTime>=c.start&&el('player').currentTime<c.end));}};
el('search').oninput=()=>{for(const b of el('cues').children)b.hidden=!b.textContent.toLowerCase().includes(el('search').value.toLowerCase());};
el('summary').oninput=()=>{draft.summary=el('summary').value;changed();};
el('add').onclick=()=>{if(draft.chapters.length>=12)return;const next=record.cues.findIndex((c,id)=>id>draft.chapters.at(-1).cueId&&c.start>=record.cues[draft.chapters.at(-1).cueId].start+10);if(next<0){text('issues','No later segment has enough room. Choose an earlier boundary or remove a chapter.');return;}draft.chapters.push({cueId:next,title:'New chapter'});chapters();changed();};
el('approve').onclick=async()=>{el('approve').disabled=true;try{const res=await fetch(`/api/recordings/${record.id}/review`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,draft})});if(!res.ok){const d=await res.json().catch(()=>({error:'Review unavailable. Reload to check for a newer draft.'}));throw Error(d.error);}dirty=false;revision=-1;await refresh();text('message','Review saved. Chapters are ready to copy or download.');}catch(e){text('issues',e.message);}finally{el('approve').disabled=false;}};
el('copy').onclick=async()=>{try{const res=await fetch(`/api/recordings/${record.id}/export/txt`);if(!res.ok)throw Error('Review the draft before exporting.');await navigator.clipboard.writeText(await res.text());text('message','YouTube chapters copied.');}catch(e){text('message',e.message+' You can also use Download chapters.');}};
el('retry').onclick=async()=>{const res=await fetch(`/api/recordings/${record.id}/retry`,{method:'POST'});text('message',res.ok?'Retry queued using the saved transcript.':'Retry unavailable. Refresh and check the stage.');await refresh();};
refresh().catch(e=>text('message',e.message));setInterval(()=>refresh().catch(()=>{}),1500);
