const el=id=>document.getElementById(id);let current='';
function line(text,className){const p=document.createElement('p');p.textContent=text;if(className)p.className=className;return p;}
async function refresh(){try{const response=await fetch('/api/state');if(!response.ok)throw Error('Unavailable');const s=await response.json();
 el('events').textContent=s.inbox.length;el('deliveries').textContent=s.inbox.reduce((n,e)=>n+e.deliveries,0);el('completions').textContent=s.videos.reduce((n,v)=>n+v.completion_count,0);el('attempts').textContent=s.inbox.reduce((n,e)=>n+e.attempts,0);
 el('inbox').replaceChildren(...s.inbox.map(e=>{const d=document.createElement('div');d.className='event';d.append(line(`${e.status} · ${e.state.toUpperCase()}`,'state'),line(`Deliveries: ${e.deliveries} · Worker attempts: ${e.attempts}`),line(`Event: ${e.event_id}`));if(e.last_error)d.append(line(e.last_error,'error'));return d;}));
 el('log').replaceChildren(...s.log.slice(0,5).map(l=>line(`${l.kind.toUpperCase()} — ${l.detail}`,l.kind==='rejected'?'error':'')));
 const v=s.videos[0];if(v){el('badge').textContent=v.state==='ready'?'Saved · ready to play':v.state;el('badge').className=v.state;el('name').textContent=v.name+(v.output_bytes?` · ${(v.output_bytes/1048576).toFixed(2)} MB saved`:'');if(v.state==='ready'&&current!==v.id){current=v.id;el('player').src='/media/'+v.id;el('play').disabled=false;el('download').href='/media/'+v.id+'?download=1';el('download').hidden=false;}}
}catch{el('badge').textContent='Database reconnecting…';}}
el('play').onclick=()=>el('player').play();refresh();setInterval(refresh,1000);
