// One-time setup for recording transcription.  Run:  npm run setup
// 1. Checks that ffmpeg and Whisper are installed (via Homebrew).
// 2. Downloads the Whisper speech-to-text model (~550 MB) into the models/ folder.
const fs = require('fs');
const path = require('path');
const { tools, MODELS_DIR } = require('../lib/media');

const MODELS = {
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', size: '~550 MB', note: 'best accuracy, fast on Apple Silicon (recommended)' },
  small: { file: 'ggml-small.bin', size: '~470 MB', note: 'faster on older Macs, less accurate' },
};
const choice = MODELS[process.argv[2]] ? process.argv[2] : 'turbo';
const model = MODELS[choice];
const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}`;

function line(ok, text) { console.log(`  ${ok ? '✓' : '✗'} ${text}`); }

async function download() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const dest = path.join(MODELS_DIR, model.file);
  if (fs.existsSync(dest)) { line(true, `Whisper model already downloaded (${model.file})`); return true; }

  console.log(`\n  Downloading the Whisper model: ${model.file} (${model.size}, ${model.note})`);
  console.log('  This is a one-time download. Keep this window open.\n');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let lastShown = -1;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    const pct = total ? Math.floor((got / total) * 100) : -1;
    if (pct !== lastShown) {
      lastShown = pct;
      process.stdout.write(`\r  ${total ? `${pct}%` : ''}  ${(got / 1e6).toFixed(0)} MB${total ? ` of ${(total / 1e6).toFixed(0)} MB` : ''}   `);
    }
  }
  await new Promise((r, j) => { out.end(r); out.on('error', j); });
  fs.renameSync(tmp, dest);
  console.log('\n');
  line(true, `Whisper model saved to models/${model.file}`);
  return true;
}

(async () => {
  console.log('\n  Meeting Assistant: transcription setup\n');
  const t = tools();
  line(!!t.ffmpeg, t.ffmpeg ? `ffmpeg found (${t.ffmpeg})` : 'ffmpeg not found');
  line(!!t.whisper, t.whisper ? `Whisper found (${t.whisper})` : 'Whisper not found');
  if (!t.ffmpeg || !t.whisper) {
    console.log('\n  Install them with Homebrew, then run  npm run setup  again:');
    console.log('\n      brew install ffmpeg whisper-cpp\n');
    console.log('  No Homebrew yet? See step 3a in README.md.\n');
  }
  try {
    await download();
  } catch (err) {
    line(false, `Model download failed: ${err.message}`);
    console.log('  Check your internet connection and run  npm run setup  again.\n');
    process.exit(1);
  }
  const after = tools();
  if (after.ffmpeg && after.whisper && after.model) {
    console.log('\n  All set. Restart the app (Ctrl+C, then npm start) and recordings will be transcribed automatically.\n');
  } else {
    console.log('\n  Almost there: install the missing tools above, then run  npm run setup  again.\n');
  }
})();
