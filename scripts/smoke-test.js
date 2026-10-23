// Quick self-check: starts the app with a throwaway data folder, a fake Claude API
// and stand-ins for ffmpeg/Whisper, then exercises every feature. Run with:  npm test
// It never touches your real meetings, never calls the real Claude API and costs nothing.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-assistant-test-'));
const fakeModel = path.join(dataDir, 'ggml-test.bin');
fs.writeFileSync(fakeModel, 'not a real model');
for (const f of ['fake-whisper.js', 'fake-ffmpeg.js']) fs.chmodSync(path.join(FIX, f), 0o755);
const MEDIA_ENV = { WHISPER_BIN: path.join(FIX, 'fake-whisper.js'), FFMPEG_BIN: path.join(FIX, 'fake-ffmpeg.js'), WHISPER_MODEL: fakeModel };

let APP_PORT;
let mockCalls = 0;
const INSIGHTS = {
  summary: 'Priya wants to replace email-based approvals before the January launch.',
  meetingPurpose: 'Discovery call about creative approvals.',
  attendees: [{ name: 'Priya Desai', role: 'Marketing' }],
  keyPoints: ['About 300 assets a month approved by email'],
  decisions: ['Book a demo for Thursday'],
  actionItems: [{ task: 'Send Teams approval video', owner: 'Rohan Mehta', due: 'Today' }],
  nextSteps: ['Demo Thursday with Arjun'],
  salesInsights: ['Budget approved this quarter'],
  objections: [{ objection: 'Adoption risk', response: 'Onboarding + approve from Teams', status: 'addressed' }],
  buyingSignals: [{ signal: 'Asked for a video', strength: 'strong' }],
  dealStage: 'Discovery',
  sentiment: { score: 78, label: 'Positive', reason: 'Budget and timeline exist.' },
  followUpEmail: { subject: 'Next steps', body: 'Hi Priya, ...' },
};

// A pretend Claude API that returns a fixed analysis.
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    mockCalls++;
    const parsed = JSON.parse(body);
    assert.equal(req.headers['x-api-key'], 'sk-ant-test-key-123456');
    assert.equal(parsed.tool_choice.name, 'save_meeting_insights');
    assert.ok(parsed.messages[0].content.includes('Priya Desai'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 'save_meeting_insights', input: INSIGHTS }] }));
  });
});

function request(method, urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const type = contentType || (data ? 'application/json' : null);
    const req = http.request({
      host: '127.0.0.1', port: APP_PORT, path: urlPath, method,
      headers: { Host: `localhost:${APP_PORT}`, ...(type ? { 'Content-Type': type } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { /* html or audio */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function startApp(env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, MY_NAME: '', ...env, DATA_DIR: dataDir, PORT: String(APP_PORT) } });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (d.toString().includes('is running')) resolve(child); });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`server exited (${code})`)));
  });
}

async function waitFor(id, statuses) {
  for (let i = 0; i < 100; i++) {
    const r = await request('GET', `/api/meetings/${id}`);
    if (statuses.includes(r.json.status)) return r.json;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`meeting ${id} never reached ${statuses}`);
}

const ok = (msg) => console.log(`  ✓ ${msg}`);

(async () => {
  // Use free ports so the test never clashes with the app you have running.
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const MOCK_PORT = mock.address().port;
  APP_PORT = await new Promise((r) => { const t = http.createServer().listen(0, '127.0.0.1', () => { const { port } = t.address(); t.close(() => r(port)); }); });

  // 1) Free mode: no API key, no transcription tools
  let app = await startApp({ ANTHROPIC_API_KEY: '', WHISPER_BIN: '/nonexistent', FFMPEG_BIN: '/nonexistent', WHISPER_MODEL: '/nonexistent' });
  let r = await request('GET', '/');
  assert.equal(r.status, 200); assert.ok(r.text.includes('Meeting Assistant')); ok('dashboard page loads');
  r = await request('GET', '/api/status');
  assert.equal(r.json.aiConfigured, false); assert.equal(r.json.media.ready, false); ok('status works with nothing set up');
  r = await request('GET', '/api/meetings');
  assert.equal(r.json.length, 4); ok('4 sample meetings loaded');
  r = await request('PATCH', '/api/meetings/sample-northwind-discovery', { actionItem: { index: 0, done: true } });
  assert.equal(r.json.insights.actionItems[0].done, true); ok('action items can be ticked off and are saved');
  r = await request('POST', '/api/meetings/sample-aster-checkin/process', {});
  assert.equal(r.status, 400); assert.ok(/copy-paste/i.test(r.json.error)); ok('one-click API mode explains the free alternative');

  r = await request('GET', '/api/meetings/sample-aster-checkin/prompt');
  assert.ok(r.json.prompt.includes('Kavya Nair') && r.json.prompt.includes('"actionItems"')); ok('copy-paste prompt includes transcript and output format');
  const reply = `Sure! Here's the analysis:\n\`\`\`json\n${JSON.stringify(INSIGHTS, null, 2)}\n\`\`\`\nLet me know if you need anything else.`;
  r = await request('POST', '/api/meetings/sample-aster-checkin/insights', { text: reply, source: 'Gemini (copy-paste)' });
  assert.equal(r.status, 200); assert.equal(r.json.status, 'processed'); assert.deepEqual(r.json.insights.decisions, ['Book a demo for Thursday']);
  assert.equal(r.json.aiModel, 'Gemini (copy-paste)'); ok('pasted AI reply (with extra chat text around it) is read and saved as MoM');
  r = await request('POST', '/api/meetings/sample-kestrel-demo/insights', { text: 'I cannot help with that.' });
  assert.equal(r.status, 400); ok('a wrong paste gives a friendly error');

  r = await request('GET', '/../server.js');
  assert.notEqual(r.status, 200); ok('server files cannot be read from the browser');
  r = await request('GET', '/.env');
  assert.equal(r.status, 404); ok('.env cannot be read from the browser');
  r = await request('POST', '/api/meetings', Buffer.from('{"transcriptText":"x"}'), 'text/plain');
  assert.equal(r.status, 415); ok('requests other websites could send are rejected');

  // A recording made while tools are missing fails gracefully...
  r = await request('POST', '/api/media?fileName=call.m4a&title=Early%20call', Buffer.alloc(5000, 1), 'audio/mp4');
  assert.equal(r.status, 201);
  const early = await waitFor(r.json.id, ['transcribe_failed']);
  assert.ok(/not set up/.test(early.lastError)); ok('recording without Whisper installed shows setup instructions');
  app.kill();

  // 2) With transcription tools and a (fake) API key
  app = await startApp({ ANTHROPIC_API_KEY: 'sk-ant-test-key-123456', ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, MY_NAME: 'Rohan Mehta', ...MEDIA_ENV });
  r = await request('GET', '/api/status');
  assert.equal(r.json.aiConfigured, true); assert.equal(r.json.media.ready, true);
  assert.ok(!r.text.includes('sk-ant-test')); ok('key detected but never sent to the browser');

  // ...and works after setup when you click Retry.
  r = await request('POST', `/api/meetings/${early.id}/transcribe`, {});
  const retried = await waitFor(early.id, ['pending']);
  assert.equal(retried.transcript[0].speaker, 'Speaker'); ok('Retry transcribes a recording once setup is done');

  // Live recording: two tracks uploaded in chunks
  r = await request('POST', '/api/recordings', { title: 'Lumen intro', account: 'Lumen Studios', attendees: 'Priya Desai, Arjun', tracks: ['me', 'others'], ext: 'webm' });
  assert.equal(r.status, 201); assert.equal(r.json.status, 'recording');
  const recId = r.json.id;
  for (const track of ['me', 'others']) {
    for (let i = 0; i < 3; i++) {
      r = await request('POST', `/api/meetings/${recId}/chunk?track=${track}`, Buffer.alloc(800, i), 'application/octet-stream');
      assert.equal(r.status, 200);
    }
  }
  assert.equal(fs.statSync(path.join(dataDir, 'recordings', recId, 'me.webm')).size, 2400); ok('recording is saved to disk in chunks while it runs');
  r = await request('POST', `/api/meetings/${recId}/finish`, { title: 'Lumen intro call', attendees: 'Priya Desai, Arjun Rao' });
  assert.equal(r.json.status, 'transcribing');
  const recorded = await waitFor(recId, ['pending']);
  assert.deepEqual(recorded.transcript.map((l) => l.speaker), ['Rohan Mehta', 'Other participants', 'Rohan Mehta', 'Other participants']);
  assert.ok(!recorded.transcript.some((l) => l.text.includes('BLANK_AUDIO')));
  assert.equal(recorded.durationMin, 1);
  assert.deepEqual(recorded.participants.map((p) => p.name), ['Rohan Mehta', 'Priya Desai', 'Arjun Rao']);
  ok('two-track recording transcribed with "you" vs "others" labels, in time order');
  ok('speaker echo picked up by your mic (no headphones) is removed');
  r = await request('GET', `/api/meetings/${recId}/audio`, null);
  assert.equal(r.status, 200);
  r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: APP_PORT, path: `/api/meetings/${recId}/audio`, headers: { Host: `localhost:${APP_PORT}`, Range: 'bytes=0-99' } }, (res) => { res.resume(); resolve(res); }));
  assert.equal(r.statusCode, 206); ok('recording can be played back (with seeking)');
  r = await request('POST', `/api/meetings/${recId}/chunk?track=me`, Buffer.alloc(10), 'application/octet-stream');
  assert.equal(r.status, 409); ok('a finished recording cannot be appended to');

  // Teams transcript import + one-click API
  const vtt = fs.readFileSync(path.join(ROOT, 'sample-data', 'example-teams-transcript.vtt'), 'utf8');
  r = await request('POST', '/api/meetings', { title: 'Intro call', account: 'Lumen Studios', transcriptText: vtt, fileName: 'example-teams-transcript.vtt' });
  assert.equal(r.status, 201);
  const m = r.json;
  assert.deepEqual(m.participants.map((p) => p.name), ['Rohan Mehta', 'Priya Desai']);
  assert.ok(fs.existsSync(path.join(dataDir, 'transcripts', `${m.id}.vtt`)));
  ok(`Teams .vtt imported (${m.transcript.length} lines, speakers detected)`);
  r = await request('POST', `/api/meetings/${m.id}/process`, {});
  assert.equal(r.status, 200); assert.equal(r.json.status, 'processed'); assert.equal(mockCalls, 1); ok('one-click Claude API analysis works (fake API)');

  r = await request('DELETE', `/api/meetings/${recId}`);
  assert.equal(r.status, 200);
  assert.ok(!fs.existsSync(path.join(dataDir, 'recordings', recId))); ok('deleting a meeting removes its recording files');
  r = await request('POST', '/api/media?fileName=notes.exe', Buffer.alloc(10), 'application/octet-stream');
  assert.equal(r.status, 400); ok('unsupported upload types are rejected');
  app.kill();

  console.log('\n  All checks passed.\n');
  mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch((err) => {
  console.error('\n  ✗ Test failed:', err.message, '\n');
  process.exit(1);
});
