const $ = id => document.getElementById(id);
let activeId = null;
let timer;
const labels = { queued: 'Queued', uploading: 'Uploading with the SDK', submitting: 'Submitting the job',
  processing: 'Processing in MediaRuntime', waiting: 'Waiting to reconnect', saving: 'Saving your MP4', ready: 'SAVED TO YOUR DISK', failed: 'Needs attention' };
function render(record) {
  activeId = record.id;
  const ready = record.status === 'ready';
  const failed = record.status === 'failed';
  $('empty').hidden = true; $('progress').hidden = ready || failed;
  $('player').hidden = !ready; $('details').hidden = !ready;
  $('badge').textContent = labels[record.status] || record.status;
  $('badge').className = ready ? 'badge ready' : 'badge';
  $('status-title').textContent = labels[record.status] || record.status;
  $('job-error').textContent = record.error || '';
  if (ready) {
    if ($('player').getAttribute('src') !== record.mediaUrl) $('player').src = record.mediaUrl;
    $('result-name').textContent = record.name;
    $('sizes').textContent = `INPUT ${(record.sourceBytes / 1024).toFixed(0)} KB → MP4 ${(record.outputBytes / 1024).toFixed(0)} KB`;
    $('job-id').textContent = `JOB ${record.jobId} · delivered from your local server`;
    $('download').href = record.mediaUrl;
  }
  clearTimeout(timer);
  if (!ready && !failed) timer = setTimeout(poll, 1500);
}
async function poll() {
  try {
    const response = await fetch(`/api/videos/${activeId}`);
    if (!response.ok) throw new Error();
    render(await response.json());
  } catch { $('job-error').textContent = 'Cannot reach the local server. Reconnecting…'; timer = setTimeout(poll, 3000); }
}
$('video').addEventListener('change', () => {
  $('filename').textContent = $('video').files[0]?.name || 'Choose an MP4 video';
  $('submit').disabled = !$('video').files.length;
});
$('upload').addEventListener('submit', async event => {
  event.preventDefault(); $('submit').disabled = true; $('form-error').textContent = '';
  try {
    const response = await fetch('/api/videos', { method: 'POST', body: new FormData(event.currentTarget) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    render(body);
  } catch (error) { $('form-error').textContent = error.message || 'Upload failed. Please try again.'; }
  finally { $('submit').disabled = false; }
});
$('play').addEventListener('click', () => $('player').play().catch(() => { $('job-error').textContent = 'Use the video controls to start playback.'; }));
fetch('/api/videos').then(r => { if (!r.ok) throw new Error(); return r.json(); })
  .then(records => { if (records[0]) render(records[0]); })
  .catch(() => { $('form-error').textContent = 'Cannot load saved videos. Check the local server.'; });
