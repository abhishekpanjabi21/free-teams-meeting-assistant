// Local storage: every meeting is one JSON file in data/meetings/ on your Mac.
// Original uploaded transcript files are kept in data/transcripts/.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const MEETINGS_DIR = path.join(DATA_DIR, 'meetings');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const SAMPLE_FILE = path.join(__dirname, '..', 'sample-data', 'meetings.json');
const SEED_MARKER = path.join(DATA_DIR, '.samples-added');
const ID_RE = /^[a-z0-9-]{3,90}$/;

const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);
const fileFor = (id) => path.join(MEETINGS_DIR, `${id}.json`);

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, file);
}

async function init() {
  await fsp.mkdir(MEETINGS_DIR, { recursive: true });
  await fsp.mkdir(TRANSCRIPTS_DIR, { recursive: true });
  await fsp.mkdir(RECORDINGS_DIR, { recursive: true });

  // First run only: copy in the sample meetings so the app has something to show.
  if (!fs.existsSync(SEED_MARKER) && fs.existsSync(SAMPLE_FILE)) {
    const samples = JSON.parse(await fsp.readFile(SAMPLE_FILE, 'utf8'));
    for (const m of samples) {
      if (!fs.existsSync(fileFor(m.id))) await writeJsonAtomic(fileFor(m.id), m);
    }
    await fsp.writeFile(SEED_MARKER, new Date().toISOString());
  }

  // If the app was closed mid-analysis, put those meetings back to "pending".
  for (const m of await list(true)) {
    if (m.status === 'processing') {
      m.status = m.insights ? 'processed' : 'pending';
      await save(m);
    }
  }
}

async function list(full = false) {
  const names = (await fsp.readdir(MEETINGS_DIR)).filter((n) => n.endsWith('.json'));
  const meetings = [];
  for (const name of names) {
    try {
      meetings.push(JSON.parse(await fsp.readFile(path.join(MEETINGS_DIR, name), 'utf8')));
    } catch (err) {
      console.warn(`Skipping unreadable meeting file ${name}: ${err.message}`);
    }
  }
  meetings.sort((a, b) => new Date(b.date) - new Date(a.date));
  return full ? meetings : meetings.map(toSummary);
}

function toSummary(m) {
  const items = m.insights?.actionItems || [];
  return {
    id: m.id,
    title: m.title,
    account: m.account,
    date: m.date,
    durationMin: m.durationMin,
    participants: m.participants || [],
    status: m.status,
    source: m.source,
    sample: !!m.sample,
    summary: m.insights?.summary || '',
    sentiment: m.insights?.sentiment || null,
    dealStage: m.insights?.dealStage || null,
    actionItemsTotal: items.length,
    actionItemsOpen: items.filter((i) => !i.done).length,
    transcriptLines: (m.transcript || []).length,
    progress: m.progress || null,
    hasAudio: !!m.audioFile,
  };
}

async function get(id) {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(await fsp.readFile(fileFor(id), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function save(meeting) {
  meeting.updatedAt = new Date().toISOString();
  await writeJsonAtomic(fileFor(meeting.id), meeting);
  return meeting;
}

async function remove(id) {
  const m = await get(id);
  if (!m) return false;
  await fsp.unlink(fileFor(id));
  if (m.originalFile) {
    const original = path.join(TRANSCRIPTS_DIR, path.basename(m.originalFile));
    await fsp.unlink(original).catch(() => {});
  }
  await fsp.rm(recordingDir(id), { recursive: true, force: true });
  return true;
}

async function saveOriginalFile(id, fileName, text) {
  const ext = (path.extname(fileName || '').toLowerCase().match(/^\.(vtt|txt|text)$/) || ['.txt'])[0];
  const name = `${id}${ext}`;
  await fsp.writeFile(path.join(TRANSCRIPTS_DIR, name), text);
  return name;
}

// Audio for one meeting lives in data/recordings/<meeting id>/
function recordingDir(id) {
  if (!isValidId(id)) throw new Error('Invalid meeting id');
  return path.join(RECORDINGS_DIR, id);
}

function newId(title) {
  const slug = String(title || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'meeting';
  return `${slug}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = { init, list, get, save, remove, saveOriginalFile, newId, isValidId, recordingDir, DATA_DIR };
