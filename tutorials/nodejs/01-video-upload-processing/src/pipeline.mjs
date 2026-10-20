import { mkdir, readFile, readdir, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { JobWaitTimeoutError, MediaRuntimeConnectionError } from '@mediaruntime/node';
import { downloadBundle, saveMp4 } from './bundle.mjs';

export class VideoPipeline {
  constructor(media, root, { allowLoopback = false, retryDelayMs = 15_000 } = {}) {
    this.media = media; this.root = root; this.allowLoopback = allowLoopback;
    this.retryDelayMs = retryDelayMs; this.queue = new Set(); this.running = false; this.closed = false;
  }
  directory(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid video ID.');
    return path.join(this.root, id);
  }
  async load(id) { return JSON.parse(await readFile(path.join(this.directory(id), 'record.json'), 'utf8')); }
  async save(record) {
    const directory = this.directory(record.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    record.updatedAt = new Date().toISOString();
    await writeFile(path.join(directory, 'record.tmp'), JSON.stringify(record), { mode: 0o600 });
    await rename(path.join(directory, 'record.tmp'), path.join(directory, 'record.json'));
  }
  publicRecord(record) {
    return { id: record.id, name: record.name, status: record.status, jobId: record.jobId ?? null,
      sourceBytes: record.sourceBytes, outputBytes: record.outputBytes ?? null, error: record.error ?? null,
      createdAt: record.createdAt, mediaUrl: record.status === 'ready' ? `/api/videos/${record.id}/media` : null };
  }
  async list() {
    const records = [];
    for (const id of await readdir(this.root)) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      try { records.push(await this.load(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async recover() {
    for (const record of await this.list()) {
      if (!['ready', 'failed'].includes(record.status)) this.enqueue(record.id);
    }
  }
  enqueue(id) { this.queue.add(id); void this.drain(); }
  async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.queue.size && !this.closed) {
        const id = this.queue.values().next().value; this.queue.delete(id);
        try { await this.process(id); }
        catch { console.error('Local storage failure; restart the worker after checking available disk space.'); }
      }
    } finally { this.running = false; }
  }
  async process(id) {
    const record = await this.load(id);
    if (record.status === 'ready' || record.status === 'failed') return;
    const directory = this.directory(id);
    try {
      if (!record.source) {
        record.status = 'uploading'; await this.save(record);
        const upload = await this.media.uploads.uploadFile(path.join(directory, 'input.mp4'), { contentType: 'video/mp4' });
        record.source = upload.fileUri;
        // Persist this URI BEFORE submission; retries reuse the same source and business key.
        await this.save(record);
      }
      if (!record.jobId) {
        record.status = 'submitting'; await this.save(record);
        const job = await this.media.jobs.create({
          source: record.source,
          outputs: ['video.web'],
          deliverWebhook: false, // This localhost tutorial polls; processing still uses account credits.
          metadata: { tutorial: 'node-video-upload', video_id: record.id },
          idempotencyKey: `node-video:${record.id}`,
        });
        record.jobId = job.id; await this.save(record);
      }
      record.status = 'processing'; record.error = null; await this.save(record);
      const result = await this.media.jobs.wait(record.jobId, { timeoutMs: 300_000 });
      if (result.status !== 'COMPLETED') {
        record.status = 'failed'; record.error = `Processing ended with ${result.status}. Check this job in your MediaRuntime workspace.`;
        await this.save(record); return;
      }
      if (!result.bundle.downloadUrl) throw new Error('Completed job has no bundle URL.');
      record.status = 'saving'; await this.save(record);
      await downloadBundle(result.bundle, path.join(directory, 'outputs.zip'), { allowLoopback: this.allowLoopback });
      await saveMp4(path.join(directory, 'outputs.zip'), path.join(directory, 'result.mp4'));
      record.outputBytes = (await stat(path.join(directory, 'result.mp4'))).size;
      record.status = 'ready'; await this.save(record);
    } catch (error) {
      // A polling timeout is not a failed job. Resume the same ID; never submit a second job.
      const retryable = error instanceof JobWaitTimeoutError || error instanceof MediaRuntimeConnectionError || error.retryable;
      record.status = retryable ? 'waiting' : 'failed';
      record.error = retryable ? 'Connection interrupted; retrying the same job.' :
        error.status === 401 ? 'API key rejected. Check the server configuration.' :
        'Processing or saving failed. Check the job in MediaRuntime; no automatic resubmission was made.';
      await this.save(record);
      // Never print the SDK response body or signed URLs.
      console.error('Pipeline issue:', error.name, error.status ?? 'local', error.requestId ?? '');
      if (retryable && !this.closed) {
        const timer = setTimeout(() => { if (!this.closed) this.enqueue(id); }, this.retryDelayMs);
        timer.unref();
      }
    }
  }
}
