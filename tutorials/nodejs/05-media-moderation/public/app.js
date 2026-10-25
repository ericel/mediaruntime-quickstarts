let current, busy=false;
const el=id=>document.getElementById(id);
const text=(id,value)=>el(id).textContent=value;
async function refresh(){
 const response=await fetch('/api/state');if(!response.ok)throw Error('Local service unavailable');
 const s=await response.json();const v=s.videos[0];if(!v)return;
 current=v;text('status',v.state);text('verdict',v.moderation?.verdict||'Pending');text('policy',v.policy_state);text('publication',v.publication);text('reason',v.policy_reason);
 text('badge',v.state==='ready'?'SAVED LOCALLY':v.state.toUpperCase());
 el('play').disabled=v.state!=='ready';
 if(v.state==='ready'&&!el('player').getAttribute('src'))el('player').src='/media/'+v.id;
 const rows=(v.moderation?.checks||[]).map(c=>{const tr=document.createElement('tr');for(const val of [c.check+(c.reviewOnly?' (advisory)':''),c.decision||'Unknown',Number.isFinite(c.confidence)?c.confidence.toFixed(3):'—']){const td=document.createElement('td');td.textContent=val;tr.append(td);}return tr;});el('checks').replaceChildren(...rows);
 text('evidence',v.moderation?`Mode: ${v.moderation.mode||'unknown'} · Analysis OK: ${v.moderation.ok===true?'yes':'no'} · Flagged checks: ${v.moderation.flaggedChecks?.join(', ')||'none reported'}`:'Awaiting analysis.');
 el('download').hidden=!v.moderation;el('download').href='/report/'+v.id;
 el('approve').disabled=busy||v.state!=='ready'||v.policy_state!=='eligible';el('hold').disabled=busy||v.state!=='ready';el('reject').disabled=busy||v.state!=='ready';
 el('published').hidden=v.publication!=='published';el('published').href='/published/'+v.id;
 text('event-proof',`${s.inbox.length} verified event(s) · ${s.inbox.reduce((n,e)=>n+e.deliveries,0)} deliveries · ${v.completion_count} saved completion(s)`);
 text('reviews',s.reviews.filter(x=>x.video_id===v.id).slice(0,2).map(x=>`${x.action.toUpperCase()}: ${x.reason}`).join(' • '));
}
el('play').onclick=()=>el('player').play();
for(const action of ['approve','hold','reject'])el(action).onclick=async()=>{busy=true;try{
 const res=await fetch('/api/review/'+current.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,reason:el('review-note').value})});
 if(!res.ok)throw Error(res.status===400?'Add a reviewer reason (at least 8 characters).':'Decision refused; resolve the moderation hold first.');
 text('action-result','Decision saved.');
}catch(e){text('action-result',e.message);}finally{busy=false;await refresh();}};
refresh().catch(()=>text('reason','Could not load local state.'));
setInterval(()=>refresh().catch(()=>{}),1000);
