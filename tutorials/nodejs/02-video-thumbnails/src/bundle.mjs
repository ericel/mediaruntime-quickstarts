import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
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

// Copy exactly one poster JPEG to a filename we control; never extract archive paths.
export async function savePoster(zipPath, output) {
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
          if (/\.jpe?g$/i.test(entry.fileName)) files.push(entry);
          zip.readEntry();
        } catch (error) { reject(error); }
      });
      zip.readEntry();
    });
    if (entries.length !== 1) throw new Error('Expected exactly one JPEG poster in the bundle.');
    const stream = await new Promise((resolve, reject) => zip.openReadStream(entries[0],
      (error, value) => error ? reject(error) : resolve(value)));
    await pipeline(stream, limitBytes(10 * 1024 * 1024), createWriteStream(part, { mode: 0o600 }));
    const dimensions = jpegDimensions(await readFile(part));
    await rename(part, output);
    return dimensions;
  } finally { zip.close(); await rm(part, { force: true }); }
}

// Read bounded JPEG frame metadata. The browser separately validates image decoding.
export function jpegDimensions(bytes) {
  if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9)
    throw new Error('Invalid JPEG markers.');
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG segment.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG segment.');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) throw new Error('Invalid JPEG frame.');
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 40_000_000)
        throw new Error('Unsupported JPEG dimensions.');
      return { width, height };
    }
    offset += length;
  }
  throw new Error('No supported JPEG frame found.');
}
