import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hasIsoMediaHeader } from './bundle.mjs';
const exec = promisify(execFile);
export async function inspectVideo(file) {
  if (!await hasIsoMediaHeader(file)) throw Error('Expected an MP4 container.');
  const { stdout } = await exec(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-of', 'json', file], { timeout: 15_000, maxBuffer: 256_000 });
  const data = JSON.parse(stdout), duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 900 ||
      !data.streams.some(s => s.codec_type === 'video' && s.codec_name === 'h264') ||
      !data.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac'))
    throw Error('Use H.264/AAC MP4 with speech, up to 15 minutes.');
  return duration;
}
