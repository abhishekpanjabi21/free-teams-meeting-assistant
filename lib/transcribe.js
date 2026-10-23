// Turns recordings into transcripts, entirely on your Mac.
// Steps for each audio track: ffmpeg -> 16 kHz WAV -> Whisper -> timed text segments.
// Recordings made in the app have two tracks: your microphone ("me") and the Teams
// audio ("others"), so we can tell who said what. Uploaded files have one track.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const store = require('./store');
const { tools, run } = require('./media');
const { mergeConsecutive } = require('./transcript');

const queue = [];
let busy = false;

function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  pump();
}

async function pump() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  try {
    await transcribeMeeting(id);
  } catch (err) {
    console.error(`Transcription failed for ${id}:`, err.message, err.stderr ? `\n${err.stderr.slice(-1500)}` : '');
  } finally {
    busy = false;
    pump();
  }
}

const myName = () => (process.env.MY_NAME || '').trim() || 'You';

function speakerFor(track) {
  if (track === 'me') return myName();
  if (track === 'others') return 'Other participants';
  return 'Speaker';
}

// Whisper sometimes outputs these for silence or music.
const NOISE = /^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+|\.+)\s*$/;

function readSegments(json, speaker) {
  return (json.transcription || [])
    .map((s) => ({
      speaker,
      start: (s.offsets?.from ?? 0) / 1000,
      end: (s.offsets?.to ?? 0) / 1000,
      text: String(s.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => s.text && !NOISE.test(s.text));
}

const words = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter((w) => w.length > 2);

// A line on your mic is treated as an echo when most of its words were also said
// on the meeting audio at about the same time (within 3 seconds).
function removeEcho(mine, theirs) {
  return mine.filter((line) => {
    const mw = words(line.text);
    if (!mw.length) return true;
    const end = Math.max(line.end, line.start);
    const near = theirs.filter((o) => o.start <= end + 3 && Math.max(o.end, o.start) >= line.start - 3);
    if (!near.length) return true;
    const heard = new Set(near.flatMap((o) => words(o.text)));
    const shared = mw.filter((w) => heard.has(w)).length;
    return shared / mw.length < 0.6;
  });
}

async function transcribeMeeting(id) {
  const meeting = await store.get(id);
  if (!meeting || !meeting.recording) return;

  const fail = async (message) => {
    const m = (await store.get(id)) || meeting;
    m.status = 'transcribe_failed';
    m.lastError = message;
    delete m.progress;
    await store.save(m);
    throw new Error(message);
  };

  const { ffmpeg, whisper, model } = tools();
  if (!ffmpeg || !whisper || !model) {
    const missing = [!ffmpeg && 'ffmpeg', !whisper && 'Whisper', !model && 'the Whisper model'].filter(Boolean).join(', ');
    return fail(`Transcription tools are not set up yet (missing: ${missing}). Open Settings for the setup steps, then click Retry.`);
  }

  const dir = store.recordingDir(id);
  const tracks = meeting.recording.tracks.filter((t) => {
    try { return fs.statSync(path.join(dir, t.file)).size > 1000; } catch { return false; }
  });
  if (!tracks.length) return fail('The recording is empty. Check that the right microphone was selected and try again.');

  let lastSave = 0;
  const setProgress = async (stage, percent, force = false) => {
    meeting.status = 'transcribing';
    meeting.progress = { stage, percent: Math.max(0, Math.min(100, Math.round(percent))) };
    if (force || Date.now() - lastSave > 1500) {
      lastSave = Date.now();
      await store.save(meeting);
    }
  };
  await setProgress('Preparing audio', 0, true);

  const byTrack = {};
  let longest = 0;
  const language = (process.env.WHISPER_LANGUAGE || 'en').trim();
  const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));

  try {
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const share = 100 / tracks.length;
      const label = tracks.length > 1 ? ` (${t.track === 'me' ? 'your voice' : 'meeting audio'})` : '';
      const wav = path.join(dir, `${t.track}.wav`);
      const outBase = path.join(dir, `${t.track}-whisper`);

      await setProgress(`Preparing audio${label}`, i * share, true);
      await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(dir, t.file), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      const seconds = Math.max(0, (fs.statSync(wav).size - 44) / 32000); // 16 kHz * 16-bit mono
      longest = Math.max(longest, seconds);

      await setProgress(`Transcribing${label}`, i * share, true);
      await run(whisper, ['-m', model, '-f', wav, '-l', language, '-t', threads, '-oj', '-of', outBase, '-pp'], {
        onStderr: (s) => {
          const m = s.match(/progress\s*=\s*(\d+)\s*%/g);
          if (m) {
            const pct = Number(m[m.length - 1].match(/(\d+)/)[1]);
            setProgress(`Transcribing${label}`, i * share + (pct / 100) * share * 0.98).catch(() => {});
          }
        },
      });
      const json = JSON.parse(await fsp.readFile(`${outBase}.json`, 'utf8'));
      byTrack[t.track] = readSegments(json, speakerFor(t.track));
      await fsp.unlink(wav).catch(() => {});
      await fsp.unlink(`${outBase}.json`).catch(() => {});
    }
  } catch (err) {
    const hint = /ffmpeg/.test(err.message) ? ' The file may be damaged or in an unsupported format.' : '';
    return fail(`${err.message}.${hint}`);
  }

  // Without headphones, your mic also hears the others through the speakers.
  // Drop those echoes so their words aren't attributed to you.
  if (byTrack.me && byTrack.others) byTrack.me = removeEcho(byTrack.me, byTrack.others);
  const lines = Object.values(byTrack).flat();

  if (!lines.length) {
    return fail('No speech was found in the recording. Check that the right microphone and meeting audio were selected.');
  }

  // A single audio file for playback in the app.
  await setProgress('Finishing up', 99, true);
  const playback = 'playback.m4a';
  try {
    const inputs = tracks.flatMap((t) => ['-i', path.join(dir, t.file)]);
    const mix = tracks.length > 1 ? ['-filter_complex', `amix=inputs=${tracks.length}:duration=longest:normalize=0`] : [];
    await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, ...mix, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', path.join(dir, playback)]);
    meeting.audioFile = playback;
  } catch (err) {
    console.warn('Could not create playback audio:', err.message);
  }

  lines.sort((a, b) => a.start - b.start);
  const latest = (await store.get(id)) || meeting;
  Object.assign(latest, {
    transcript: mergeConsecutive(lines),
    durationMin: Math.max(1, Math.round(longest / 60)),
    audioFile: meeting.audioFile || null,
    status: latest.insights ? 'processed' : 'pending',
    transcribedAt: new Date().toISOString(),
  });
  delete latest.progress;
  delete latest.lastError;
  await store.save(latest);
}

module.exports = { enqueue, removeEcho };
