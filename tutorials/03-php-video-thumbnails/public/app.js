const form = document.querySelector('#upload');
form.addEventListener('submit', async event => {
  event.preventDefault(); const button=form.querySelector('button');button.disabled=true;
  try {
    const response=await fetch('upload.php',{method:'POST',body:new FormData(form)});
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    window.location.reload();
  } catch(error) {document.querySelector('#feedback').textContent=error.message;button.disabled=false;}
});
document.querySelectorAll('article[data-id]').forEach(card=>{
  async function poll() {
    try {
      const response=await fetch('status.php?id='+card.dataset.id);if(!response.ok)throw new Error('Status unavailable. Refresh to retry.');
      const data=await response.json();card.querySelector('.status').textContent=data.status;
      const message=card.querySelector('.message');
      if(data.status==='failed'){message.textContent=data.error;return;}
      if(data.status!=='ready'){message.textContent='Processing remotely. Your PHP worker will download and save the result.';setTimeout(poll,2000);return;}
      message.textContent='Saved in your application storage • Frame requested at '+data.time_sec+' seconds';
      const image=card.querySelector('img');image.src=data.image_url;image.hidden=false;
      card.querySelector('.details').hidden=false;
      card.querySelector('.dimensions').textContent=data.image.width+' × '+data.image.height+' · JPEG';
      card.querySelector('a').href=data.image_url;
    }catch(error){card.querySelector('.message').textContent=error.message;}
  }
  poll();
});
