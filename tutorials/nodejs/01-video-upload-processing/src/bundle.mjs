import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import yauzl from 'yauzl';

const MAX_BYTES = 100 * 1024 * 1024;
function limitBytes(max) {
  let size = 0;
  return new Transform({ transform(chunk, _encoding, done) {
    size += chunk.length;
    done(size > max ? new Error('Media exceeds the download limit.') : null, chunk);
  }});
}

// Download the canonical ZIP. Never pass the API key to its signed URL.
export async function downloadBundle(bundle, destination, { allowLoopback = false } = {}) {
  let url = new URL(bundle.downloadUrl);
  if (url.protocol !== 'https:' && !(allowLoopback && url.hostname === '127.0.0.1')) {
    throw new Error('Expected an HTTPS bundle URL.');
  }
  const signal = AbortSignal.timeout(120_000);
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetch(url, { redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 3) throw new Error('Invalid bundle redirect.');
    url = new URL(location, url);
    if (url.username || url.password || (url.protocol !== 'https:' && !(allowLoopback && url.hostname === '127.0.0.1')))
      throw new Error('Unsafe bundle redirect.');
  }
  if (!response.ok || !response.body) throw new Error('Bundle download failed.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) { await response.body.cancel(); throw new Error('Bundle too large.'); }
  const part = `${destination}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), limitBytes(MAX_BYTES), createWriteStream(part, { mode: 0o600 }));
    if (bundle.sha256) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(part)) hash.update(chunk);
      if (hash.digest('hex').toLowerCase() !== bundle.sha256.toLowerCase()) throw new Error('Bundle checksum mismatch.');
    }
    await rename(part, destination);
  } finally { await rm(part, { force: true }); }
}

export async function isMp4(file) {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    return bytesRead === 12 && header.toString('ascii', 4, 8) === 'ftyp';
  } finally { await handle.close(); }
}

// Do not extract arbitrary archive paths. Copy one selected MP4 to our own filename.
// video.web currently yields one MP4; if a bundle contains several, select alphabetically.
export async function saveMp4(zipPath, output) {
  const zip = await new Promise((resolve, reject) => yauzl.open(zipPath,
    { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true },
    (error, file) => error ? reject(error) : resolve(file)));
  const part = `${output}.part`;
  try {
    const entries = await new Promise((resolve, reject) => {
      const files = []; let count = 0; let total = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', entry => {
        try {
          if (++count > 200 || (total += entry.uncompressedSize) > MAX_BYTES) throw new Error('Archive exceeds limits.');
          if (path.posix.isAbsolute(entry.fileName) || entry.fileName.split('/').includes('..')) throw new Error('Unsafe archive path.');
          const type = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (type && type !== 0o100000 && type !== 0o040000) throw new Error('Unsupported archive entry.');
          if (entry.generalPurposeBitFlag & 1) throw new Error('Encrypted ZIP unsupported.');
          if (/\.mp4$/i.test(entry.fileName)) files.push(entry);
          zip.readEntry();
        } catch (error) { reject(error); }
      });
      zip.readEntry();
    });
    entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
    if (!entries.length) throw new Error('No MP4 found in the bundle.');
    const stream = await new Promise((resolve, reject) => zip.openReadStream(entries[0],
      (error, value) => error ? reject(error) : resolve(value)));
    await pipeline(stream, limitBytes(MAX_BYTES), createWriteStream(part, { mode: 0o600 }));
    if (!await isMp4(part)) throw new Error('The output is not an MP4 file.');
    await rename(part, output);
    return entries.length;
  } finally { zip.close(); await rm(part, { force: true }); }
}
