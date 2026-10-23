// Finds the free, local audio tools installed with Homebrew:
//   ffmpeg      - converts any audio/video file into the format Whisper needs
//   whisper-cli - Whisper speech-to-text (from the "whisper-cpp" Homebrew package)
// and the Whisper model file downloaded by `npm run setup`.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MODELS_DIR = path.join(__dirname, '..', 'models');
// Best first. large-v3-turbo is accurate and fast on Apple Silicon.
const MODEL_PREFERENCE = [
  'ggml-large-v3-turbo-q5_0.bin', 'ggml-large-v3-turbo.bin', 'ggml-medium.bin',
  'ggml-small.bin', 'ggml-base.bin', 'ggml-medium.en.bin', 'ggml-small.en.bin', 'ggml-base.en.bin',
];

function searchDirs() {
  return [...new Set([...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'])].filter(Boolean);
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findBin(names, override) {
  if (override) return isExecutable(override) ? override : null;
  for (const dir of searchDirs()) {
    for (const name of names) {
      const p = path.join(dir, name);
      if (isExecutable(p)) return p;
    }
  }
  return null;
}

function findModel() {
  if (process.env.WHISPER_MODEL) {
    const p = path.resolve(process.env.WHISPER_MODEL);
    return fs.existsSync(p) ? p : null;
  }
  for (const name of MODEL_PREFERENCE) {
    const p = path.join(MODELS_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  try {
    const any = fs.readdirSync(MODELS_DIR).find((f) => /^ggml-.*\.bin$/.test(f));
    if (any) return path.join(MODELS_DIR, any);
  } catch { /* no models folder yet */ }
  return null;
}

const tools = () => ({
  ffmpeg: findBin(['ffmpeg'], process.env.FFMPEG_BIN),
  whisper: findBin(['whisper-cli', 'whisper-cpp'], process.env.WHISPER_BIN),
  model: findModel(),
});

function mediaStatus() {
  const t = tools();
  return {
    ffmpeg: !!t.ffmpeg,
    whisper: !!t.whisper,
    model: t.model ? path.basename(t.model) : null,
    ready: !!(t.ffmpeg && t.whisper && t.model),
  };
}

// Runs a program and resolves when it finishes successfully.
function run(cmd, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr = (stderr + s).slice(-8000);
      if (onStderr) onStderr(s);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(stderr);
      const err = new Error(`${path.basename(cmd)} failed (exit code ${code})`);
      err.stderr = stderr;
      reject(err);
    });
  });
}

module.exports = { tools, mediaStatus, run, MODELS_DIR };
