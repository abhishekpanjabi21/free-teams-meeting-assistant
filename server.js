// Meeting Assistant — local web server.
// Start it with:  npm start   then open http://localhost:3000
// It only listens on your own Mac (127.0.0.1), so nothing is exposed to your network.

const { loadEnv } = require('./lib/env');
loadEnv();

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./lib/store');
const { parseTranscript } = require('./lib/transcript');
const { analyzeMeeting, isAIConfigured, modelName, parsePastedInsights } = require('./lib/claude');
const { buildChatPrompt } = require('./lib/prompt');
const { mediaStatus } = require('./lib/media');
const transcriber = require('./lib/transcribe');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_JSON = 15 * 1024 * 1024;
const MAX_MEDIA = 4 * 1024 * 1024 * 1024; // 4 GB per uploaded recording
const MAX_CHUNK = 50 * 1024 * 1024;
const MEDIA_EXTS = ['mp3', 'm4a', 'mp4', 'mov', 'm4v', 'wav', 'webm', 'aac', 'ogg', 'oga', 'opus', 'mkv', 'flac', 'wma', 'avi'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  if (!(req.headers['content-type'] || '').includes('application/json')) {
    return Promise.reject(new HttpError(415, 'Requests must be JSON.'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON) {
        reject(new HttpError(413, 'That file is too large (the limit is 15 MB).'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid request body.')); }
    });
    req.on('error', reject);
  });
}

// Streams a binary request body (audio) straight to a file on disk.
function saveBody(req, file, { append = false, limit }) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const out = fs.createWriteStream(file, { flags: append ? 'a' : 'w' });
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit && !failed) {
        failed = true;
        req.unpipe(out);
        out.destroy();
        req.resume();
        reject(new HttpError(413, 'That file is too large.'));
      }
    });
    req.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => { if (!failed) resolve(size); });
    req.pipe(out);
  });
}

const cleanText = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const validDate = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const cleanList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => cleanText(String(s), 80)).filter(Boolean).slice(0, 40);

function participantsFrom(attendees, includeMe) {
  const me = (process.env.MY_NAME || '').trim() || 'You';
  const people = includeMe ? [{ name: me, side: 'us' }] : [];
  for (const name of attendees) {
    if (!people.some((p) => p.name.toLowerCase() === name.toLowerCase())) people.push({ name });
  }
  return people;
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['api','meetings','abc','process']
  const method = req.method;

  // Browsers only let *this* page send JSON or audio here; other websites get blocked.
  if (!['GET', 'HEAD', 'DELETE'].includes(method)) {
    const type = req.headers['content-type'] || '';
    if (!/^(application\/json|application\/octet-stream|audio\/|video\/)/.test(type)) {
      throw new HttpError(415, 'Unsupported request type.');
    }
  }

  if (parts[1] === 'status' && parts.length === 2 && method === 'GET') {
    return sendJson(res, 200, {
      aiConfigured: isAIConfigured(),
      model: modelName(),
      media: mediaStatus(),
      myName: (process.env.MY_NAME || '').trim(),
      dataDir: store.DATA_DIR,
      version: require('./package.json').version,
    });
  }

  // Upload an audio/video recording file → transcribe it.
  if (parts[1] === 'media' && parts.length === 2 && method === 'POST') {
    return sendJson(res, 201, await uploadMedia(req, url));
  }

  // Start a live recording from the browser.
  if (parts[1] === 'recordings' && parts.length === 2 && method === 'POST') {
    return sendJson(res, 201, await startRecording(await readJson(req)));
  }

  if (parts[1] !== 'meetings') throw new HttpError(404, 'Not found.');

  if (parts.length === 2) {
    if (method === 'GET') return sendJson(res, 200, await store.list());
    if (method === 'POST') return sendJson(res, 201, await createFromTranscript(await readJson(req)));
    throw new HttpError(405, 'Method not allowed.');
  }

  const id = parts[2];
  const meeting = await store.get(id);
  if (!meeting) throw new HttpError(404, 'Meeting not found.');

  if (parts.length === 3) {
    if (method === 'GET') return sendJson(res, 200, meeting);
    if (method === 'PATCH') return sendJson(res, 200, await updateMeeting(meeting, await readJson(req)));
    if (method === 'DELETE') { await store.remove(id); return sendJson(res, 200, { ok: true }); }
    throw new HttpError(405, 'Method not allowed.');
  }

  const action = parts[3];
  if (parts.length !== 4) throw new HttpError(404, 'Not found.');

  if (action === 'process' && method === 'POST') return sendJson(res, 200, await processMeeting(meeting));
  if (action === 'prompt' && method === 'GET') {
    if (!meeting.transcript?.length) throw new HttpError(400, 'This meeting has no transcript yet.');
    return sendJson(res, 200, { prompt: buildChatPrompt(meeting) });
  }
  if (action === 'insights' && method === 'POST') return sendJson(res, 200, await savePastedInsights(meeting, await readJson(req)));
  if (action === 'chunk' && method === 'POST') return sendJson(res, 200, await saveChunk(meeting, req, url));
  if (action === 'finish' && method === 'POST') return sendJson(res, 200, await finishRecording(meeting, await readJson(req)));
  if (action === 'transcribe' && method === 'POST') return sendJson(res, 200, await retryTranscription(meeting));
  if (action === 'audio' && (method === 'GET' || method === 'HEAD')) return serveAudio(req, res, meeting);

  throw new HttpError(404, 'Not found.');
}

async function createFromTranscript(body) {
  const text = typeof body.transcriptText === 'string' ? body.transcriptText : '';
  if (text.trim().length < 20) throw new HttpError(400, 'The transcript looks empty. Upload a .vtt or .txt file, or paste the text.');

  const fileName = cleanText(body.fileName, 150);
  const parsed = parseTranscript(text, fileName);
  if (!parsed.lines.length) throw new HttpError(400, "Couldn't find any spoken lines in that transcript. Try the .vtt download from Teams.");

  const fallbackTitle = fileName ? fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : 'Untitled meeting';
  const title = cleanText(body.title, 140) || fallbackTitle;
  const id = store.newId(title);
  const now = new Date().toISOString();

  return store.save({
    id,
    title,
    account: cleanText(body.account, 120),
    date: validDate(body.date) || now,
    durationMin: parsed.durationMin,
    participants: parsed.speakers.map((name) => ({ name })),
    source: fileName ? 'upload' : 'paste',
    originalFile: fileName ? await store.saveOriginalFile(id, fileName, text) : null,
    status: 'pending',
    transcript: parsed.lines,
    insights: null,
    createdAt: now,
  });
}

async function uploadMedia(req, url) {
  const q = url.searchParams;
  const fileName = cleanText(q.get('fileName'), 150);
  const ext = (path.extname(fileName).slice(1) || '').toLowerCase();
  if (!MEDIA_EXTS.includes(ext)) {
    req.resume();
    throw new HttpError(400, `That file type isn't supported. Use one of: ${MEDIA_EXTS.join(', ')}.`);
  }
  const title = cleanText(q.get('title'), 140) || fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') || 'Recorded meeting';
  const attendees = cleanList(q.get('attendees'));
  const id = store.newId(title);
  const dir = store.recordingDir(id);
  await fsp.mkdir(dir, { recursive: true });
  const file = `upload.${ext}`;
  try {
    await saveBody(req, path.join(dir, file), { limit: MAX_MEDIA });
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw err;
  }

  const now = new Date().toISOString();
  const meeting = await store.save({
    id,
    title,
    account: cleanText(q.get('account'), 120),
    date: validDate(q.get('date')) || now,
    durationMin: null,
    attendees,
    participants: participantsFrom(attendees, false),
    source: 'recording-upload',
    originalFileName: fileName,
    recording: { tracks: [{ track: 'upload', file }] },
    status: 'transcribing',
    progress: { stage: 'Waiting to start', percent: 0 },
    transcript: [],
    insights: null,
    createdAt: now,
  });
  transcriber.enqueue(id);
  return meeting;
}

async function startRecording(body) {
  const ext = body.ext === 'mp4' ? 'mp4' : 'webm';
  const wanted = Array.isArray(body.tracks) ? body.tracks : ['me'];
  const tracks = ['me', 'others'].filter((t) => wanted.includes(t)).map((t) => ({ track: t, file: `${t}.${ext}` }));
  if (!tracks.length) throw new HttpError(400, 'Choose at least one audio source.');

  const title = cleanText(body.title, 140) || `Meeting ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const attendees = cleanList(body.attendees);
  const id = store.newId(title);
  await fsp.mkdir(store.recordingDir(id), { recursive: true });
  const now = new Date().toISOString();
  return store.save({
    id,
    title,
    account: cleanText(body.account, 120),
    date: now,
    durationMin: null,
    attendees,
    participants: participantsFrom(attendees, true),
    source: 'recording',
    recording: { tracks, startedAt: now },
    status: 'recording',
    transcript: [],
    insights: null,
    createdAt: now,
  });
}

async function saveChunk(meeting, req, url) {
  const track = url.searchParams.get('track');
  const t = meeting.recording?.tracks.find((x) => x.track === track);
  if (meeting.status !== 'recording' || !t) {
    req.resume();
    throw new HttpError(409, 'This meeting is not recording.');
  }
  const size = await saveBody(req, path.join(store.recordingDir(meeting.id), t.file), { append: true, limit: MAX_CHUNK });
  return { ok: true, size };
}

async function finishRecording(meeting, body) {
  if (meeting.status !== 'recording') throw new HttpError(409, 'This recording was already finished.');
  if (cleanText(body.title)) meeting.title = cleanText(body.title, 140);
  if (typeof body.account === 'string') meeting.account = cleanText(body.account, 120);
  if (body.attendees !== undefined) {
    meeting.attendees = cleanList(body.attendees);
    meeting.participants = participantsFrom(meeting.attendees, true);
  }
  meeting.recording.endedAt = new Date().toISOString();
  meeting.status = 'transcribing';
  meeting.progress = { stage: 'Waiting to start', percent: 0 };
  await store.save(meeting);
  transcriber.enqueue(meeting.id);
  return meeting;
}

async function retryTranscription(meeting) {
  if (!meeting.recording) throw new HttpError(400, 'This meeting has no recording.');
  if (meeting.status === 'transcribing') return meeting;
  meeting.status = 'transcribing';
  meeting.progress = { stage: 'Waiting to start', percent: 0 };
  delete meeting.lastError;
  await store.save(meeting);
  transcriber.enqueue(meeting.id);
  return meeting;
}

async function serveAudio(req, res, meeting) {
  if (!meeting.audioFile) throw new HttpError(404, 'No audio for this meeting.');
  const file = path.join(store.recordingDir(meeting.id), path.basename(meeting.audioFile));
  let stat;
  try { stat = await fsp.stat(file); } catch { throw new HttpError(404, 'Audio file is missing.'); }

  const headers = { 'Content-Type': 'audio/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function updateMeeting(meeting, body) {
  if (typeof body.title === 'string' && cleanText(body.title)) meeting.title = cleanText(body.title, 140);
  if (typeof body.account === 'string') meeting.account = cleanText(body.account, 120);
  if (body.date && validDate(body.date)) meeting.date = validDate(body.date);

  if (body.actionItem && meeting.insights) {
    const { index, done } = body.actionItem;
    const item = meeting.insights.actionItems?.[index];
    if (!item || typeof done !== 'boolean') throw new HttpError(400, 'Unknown action item.');
    item.done = done;
  }
  return store.save(meeting);
}

function applyInsights(meeting, insights, source) {
  // Keep ticks on action items that are unchanged between runs.
  const oldDone = new Set((meeting.insights?.actionItems || []).filter((a) => a.done).map((a) => a.task));
  insights.actionItems.forEach((a) => { a.done = oldDone.has(a.task); });
  meeting.insights = insights;
  meeting.status = 'processed';
  meeting.processedAt = new Date().toISOString();
  meeting.aiModel = source;
  delete meeting.lastError;
}

async function savePastedInsights(meeting, body) {
  if (!meeting.transcript?.length) throw new HttpError(400, 'This meeting has no transcript yet.');
  let insights;
  try { insights = parsePastedInsights(body.text); } catch (err) { throw new HttpError(err.status || 400, err.message); }
  applyInsights(meeting, insights, cleanText(body.source, 40) || 'AI chat (copy-paste)');
  return store.save(meeting);
}

const inFlight = new Set();

async function processMeeting(meeting) {
  if (!isAIConfigured()) {
    throw new HttpError(400, 'The Claude API is not connected. Use the free copy-paste option, or add an API key (see Settings).');
  }
  if (inFlight.has(meeting.id)) throw new HttpError(409, 'This meeting is already being analysed.');
  if (!meeting.transcript?.length) throw new HttpError(400, 'This meeting has no transcript to analyse.');

  inFlight.add(meeting.id);
  const previousStatus = meeting.status;
  meeting.status = 'processing';
  await store.save(meeting);
  try {
    const insights = await analyzeMeeting(meeting);
    applyInsights(meeting, insights, modelName());
    return await store.save(meeting);
  } catch (err) {
    meeting.status = previousStatus === 'processed' ? 'processed' : 'pending';
    meeting.lastError = err.message;
    await store.save(meeting);
    throw new HttpError(err.status || 502, err.message);
  } finally {
    inFlight.delete(meeting.id);
  }
}

// ---------- Static files (the dashboard) ----------

async function serveStatic(res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch { throw new HttpError(400, 'Bad path.'); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found.');
  let data;
  try { data = await fsp.readFile(file); } catch { throw new HttpError(404, 'Not found.'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const server = http.createServer(async (req, res) => {
  try {
    // Blocks "DNS rebinding" tricks: only answer requests addressed to this Mac.
    if (!ALLOWED_HOSTS.has(req.headers.host)) throw new HttpError(403, 'Forbidden host.');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    return await serveStatic(res, url.pathname);
  } catch (err) {
    if (!err.status || (err.status >= 500 && err.status !== 502)) console.error(err);
    if (res.headersSent) return res.end();
    sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server. Check the Terminal window for details.' });
  }
});
server.requestTimeout = 0; // large recordings can take a while to upload

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Either the app is already running in another Terminal window,\nor start it on a different port with:  PORT=3001 npm start\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

store.init().then(async () => {
  // Resume any transcriptions that were interrupted when the app was closed.
  for (const m of await store.list(true)) {
    if (m.status === 'transcribing') transcriber.enqueue(m.id);
  }
  server.listen(PORT, HOST, () => {
    const media = mediaStatus();
    console.log('\n  Meeting Assistant is running');
    console.log(`  Open:  http://localhost:${PORT}`);
    console.log(`  Claude API: ${isAIConfigured() ? `connected (${modelName()})` : 'not connected (free copy-paste mode works)'}`);
    console.log(`  Transcription: ${media.ready ? `ready (${media.model})` : 'not set up yet (see Settings in the app)'}`);
    console.log(`  Your meetings are saved in: ${store.DATA_DIR}`);
    console.log('  Press Ctrl+C to stop.\n');
  });
}).catch((err) => {
  console.error('Could not start the app:', err);
  process.exit(1);
});
