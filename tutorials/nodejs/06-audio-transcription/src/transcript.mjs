// Parse the service-generated WebVTT subset into plain text, never HTML.
// Preserve timestamps; a segment is not a word-level alignment guarantee.
function timestamp(value) {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw Error('Invalid cue time.');
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}
export function parseVtt(source) {
  if (Buffer.byteLength(source, 'utf8') > 2 * 1024 * 1024) throw Error('Transcript exceeds limit.');
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized)) throw Error('Expected WebVTT.');
  const blocks = normalized.trim().split(/\n[ \t]*\n/).slice(1);
  const cues = []; let previous = -1;
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[0])) continue;
    const index = lines[0].includes('-->') ? 0 : 1;
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[index] || '');
    if (!match) throw Error('Invalid cue block.');
    const start = timestamp(match[1]), end = timestamp(match[2]);
    if (end <= start || start < previous || end > 604800) throw Error('Invalid cue range.');
    const text = lines.slice(index+1).join(' ').trim();
    if (!text || text.length > 10000 || cues.length >= 10000) throw Error('Invalid cue text.');
    cues.push({start, end, text}); previous = start;
  }
  return cues;
}
