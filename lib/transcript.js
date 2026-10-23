// Turns a Microsoft Teams transcript (.vtt or plain text) into a clean list of
// { speaker, start, end, text } lines.

const UNKNOWN = 'Unknown speaker';

function toSeconds(stamp) {
  if (!stamp) return null;
  const parts = stamp.replace(',', '.').split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

// WebVTT, as downloaded from Teams ("Download as .vtt"):
//   00:00:03.120 --> 00:00:07.480
//   <v Sarah Lin>Thanks for joining, everyone.</v>
function parseVtt(text) {
  const out = [];
  for (const block of text.split(/\n\s*\n/)) {
    const rows = block.split('\n').map((s) => s.trim()).filter(Boolean);
    const timeIdx = rows.findIndex((r) => r.includes('-->'));
    if (timeIdx === -1) continue;
    const [startRaw, endRaw] = rows[timeIdx].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    let body = rows.slice(timeIdx + 1).join(' ');
    let speaker = UNKNOWN;
    const voice = body.match(/<v\s+([^>]+)>/i);
    if (voice) {
      speaker = voice[1].trim();
    } else {
      const named = body.match(/^([A-Za-z][\w .'-]{0,50}?):\s+(.+)$/);
      if (named) { speaker = named[1].trim(); body = named[2]; }
    }
    body = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!body) continue;
    out.push({ speaker, start: toSeconds(startRaw), end: toSeconds(endRaw), text: body });
  }
  return out;
}

// Plain text. Handles the common shapes people paste from Teams/Word:
//   "Sarah Lin   0:03" on one line, then what they said on the next lines
//   "[00:01:02] Sarah Lin: what they said"
//   "Sarah Lin: what they said"
function parsePlain(text) {
  const out = [];
  let current = null;
  const header = /^(.{1,60}?)\s+(\d{1,2}:\d{2}(?::\d{2})?)$/;
  const stamped = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*([^:]{1,60}):\s*(.+)$/;
  const named = /^([A-Za-z][\w.'-]*(?:\s+[A-Za-z][\w.'-]*){0,4}):\s+(.+)$/;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(stamped))) {
      current = { speaker: m[2].trim(), start: toSeconds(m[1]), end: null, text: m[3].trim() };
      out.push(current);
    } else if ((m = line.match(header)) && !/[.?!]$/.test(m[1])) {
      current = { speaker: m[1].trim(), start: toSeconds(m[2]), end: null, text: '' };
      out.push(current);
    } else if ((m = line.match(named))) {
      current = { speaker: m[1].trim(), start: null, end: null, text: m[2].trim() };
      out.push(current);
    } else if (current) {
      current.text = (current.text + ' ' + line).trim();
    } else {
      current = { speaker: UNKNOWN, start: null, end: null, text: line };
      out.push(current);
    }
  }
  return out.filter((l) => l.text);
}

// Teams splits sentences into many tiny captions; join back-to-back lines from the same person.
function mergeConsecutive(lines) {
  const merged = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === line.speaker && prev.text.length < 600) {
      prev.text = `${prev.text} ${line.text}`;
      if (line.end != null) prev.end = line.end;
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

function parseTranscript(text, fileName = '') {
  const clean = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const looksVtt = /^WEBVTT/.test(clean.trim()) || /\.vtt$/i.test(fileName) ||
    /\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(clean);
  const lines = mergeConsecutive(looksVtt ? parseVtt(clean) : parsePlain(clean));

  const lastSecond = Math.max(0, ...lines.map((l) => l.end ?? l.start ?? 0));
  const speakers = [...new Set(lines.map((l) => l.speaker))];
  return {
    lines,
    speakers,
    durationMin: lastSecond > 0 ? Math.max(1, Math.round(lastSecond / 60)) : null,
    format: looksVtt ? 'vtt' : 'text',
  };
}

module.exports = { parseTranscript, mergeConsecutive };
