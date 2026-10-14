document.querySelectorAll('article[data-status-url]').forEach(card => {
  let player = null;
  async function update() {
    const message = card.querySelector('.message');
    try {
      const response = await fetch(card.dataset.statusUrl, {headers: {Accept: 'application/json'}});
      if (!response.ok) throw new Error('Status unavailable. Refresh this page to retry.');
      const data = await response.json();
      card.querySelector('.status').textContent = data.status;
      if (data.status === 'failed') { message.textContent = data.error; return; }
      if (data.status !== 'ready') {
        message.textContent = 'Processing remotely. This page checks progress every three seconds.';
        setTimeout(update, 3000); return;
      }
      message.textContent = 'Your stream is ready. Press play to watch the HLS result.';
      const video = card.querySelector('video');
      video.hidden = false;
      card.querySelector('.player-info').hidden = false;
      card.querySelector('.playlist').href = data.playlist;
      if (window.Hls && Hls.isSupported()) {
        player = new Hls(); player.loadSource(data.playlist); player.attachMedia(video);
        player.on(Hls.Events.MANIFEST_PARSED, () => {
          card.querySelector('.renditions').textContent = 'Available renditions: ' + player.levels.map(l => l.height ? l.height + 'p' : Math.round(l.bitrate / 1000) + ' kbps').join(' / ');
        });
        player.on(Hls.Events.ERROR, (_event, detail) => {
          if (detail.fatal) { message.textContent = 'Playback failed. Refresh to retry.'; player.destroy(); }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = data.playlist;
      } else { message.textContent = 'This browser cannot play HLS. Try a current Safari, Chrome, or Firefox.'; }
    } catch (error) { message.textContent = error.message; }
  }
  update();
});
