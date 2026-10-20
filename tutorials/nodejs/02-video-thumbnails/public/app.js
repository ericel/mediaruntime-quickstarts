const $ = id => document.getElementById(id);
let activeId = null;
let timer;
let previewUrl;
let videoDuration = 0;
const labels = { queued: 'Queued', uploading: 'Uploading your video', submitting: 'Submitting the poster job',
  processing: 'Extracting your chosen frame', waiting: 'Waiting to reconnect', saving: 'Saving your JPEG', ready: 'SAVED TO YOUR DISK', failed: 'Needs attention' };
function render(record) {
  activeId = record.id;
  const ready = record.status === 'ready';
  $('empty').hidden = true;
  $('progress').hidden = ready || record.status === 'failed';
  $('result').hidden = !ready;
  $('badge').textContent = labels[record.status] || record.status;
  $('badge').className = ready ? 'badge ready' : 'badge';
  $('status-title').textContent = labels[record.status] || record.status;
  $('job-error').textContent = record.error || '';
  if (ready) {
    if ($('poster').getAttribute('src') !== record.imageUrl) $('poster').src = record.imageUrl;
    $('poster').alt = `Thumbnail from ${record.name} at ${record.timestamp} seconds`;
    $('result-name').textContent = `${record.name} · ${record.timestamp}s`;
    $('dimensions').textContent = `${record.width} × ${record.height} · ${(record.outputBytes / 1024).toFixed(0)} KB`;
    $('job-id').textContent = `JOB ${record.jobId} · served from your saved JPEG`;
    $('download').href = record.imageUrl + '?download=1';
    $('open-image').href = record.imageUrl;
  }
  clearTimeout(timer);
  if (!ready && record.status !== 'failed') timer = setTimeout(poll, 1500);
}
async function poll() {
  try {
    const response = await fetch(`/api/thumbnails/${activeId}`);
    if (!response.ok) throw new Error();
    render(await response.json());
  } catch { $('job-error').textContent = 'Cannot reach the local server. Reconnecting…'; timer = setTimeout(poll, 3000); }
}
function validTime() {
  const t = Number($('timestamp').value);
  return $('timestamp').value !== '' && Number.isFinite(t) && t >= 0 && t < videoDuration && t <= 600;
}
$('video').addEventListener('change', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  videoDuration = 0;
  $('submit').disabled = true; $('use-frame').disabled = true; $('form-error').textContent = '';
  const file = $('video').files[0];
  $('filename').textContent = file?.name || 'No file selected';
  if (!file) { $('source').removeAttribute('src'); $('source').hidden = true; $('source-empty').hidden = false; return; }
  if (file.size > 20 * 1024 * 1024) { $('form-error').textContent = 'Choose an MP4 up to 20 MB.'; return; }
  previewUrl = URL.createObjectURL(file);
  $('source').src = previewUrl; $('source').hidden = false; $('source-empty').hidden = true;
});
$('source').addEventListener('loadedmetadata', () => {
  videoDuration = $('source').duration;
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;
  $('timestamp').max = String(Math.min(600, Math.max(0, videoDuration - .001)));
  if (!validTime()) $('timestamp').value = String(Math.min(1.5, videoDuration / 2).toFixed(3));
  $('source').currentTime = Number($('timestamp').value);
  $('source-info').textContent = `Duration: ${videoDuration.toFixed(2)}s. Pick a time before the end; this demo supports the first 600 seconds.`;
  $('submit').disabled = false; $('use-frame').disabled = false;
});
$('source').addEventListener('error', () => { $('form-error').textContent = 'This browser cannot preview the video. Choose a browser-playable MP4.'; $('submit').disabled = true; });
$('timestamp').addEventListener('change', () => { if (validTime()) { $('source').pause(); $('source').currentTime = Number($('timestamp').value); } });
$('use-frame').addEventListener('click', () => { $('source').pause(); $('timestamp').value = Math.min(600, $('source').currentTime).toFixed(3); });
$('poster').addEventListener('error', () => { $('job-error').textContent = 'The saved image could not be loaded. Check the server and local storage.'; });
$('upload').addEventListener('submit', async event => {
  event.preventDefault(); $('form-error').textContent = '';
  if (!validTime()) { $('form-error').textContent = 'Choose a time inside this video, no later than 600 seconds.'; return; }
  $('submit').disabled = true;
  try {
    const response = await fetch('/api/thumbnails', { method: 'POST', body: new FormData(event.currentTarget) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    render(body);
  } catch (error) { $('form-error').textContent = error.message || 'Upload failed. Please try again.'; }
  finally { $('submit').disabled = false; }
});
fetch('/api/thumbnails').then(r => { if (!r.ok) throw new Error(); return r.json(); })
  .then(records => { if (records[0]) render(records[0]); })
  .catch(() => { $('form-error').textContent = 'Cannot load saved thumbnails. Check the local server.'; });
