#!/usr/bin/env node
// Stand-in for whisper-cli, used only by `npm test`. Writes a fixed transcript
// in the same JSON format as the real whisper.cpp.
const fs = require('fs');
const args = process.argv.slice(2);
const val = (flag) => args[args.indexOf(flag) + 1];
const input = val('-f');
const out = val('-of');
const isMe = /me\.wav$/.test(input);

const segments = isMe
  ? [[1000, 4000, ' Hi Priya, thanks for joining.'], [4700, 8300, ' thanks our budget is approved for this quarter'], [9000, 12000, ' Should we book the demo for Thursday?']]
  : [[4500, 8500, ' Thanks. Our budget is approved for this quarter.'], [12500, 14000, ' [BLANK_AUDIO]'], [14000, 16500, ' Thursday works.']];

for (const p of [25, 50, 100]) process.stderr.write(`whisper_print_progress_callback: progress = ${p}%\n`);
fs.writeFileSync(`${out}.json`, JSON.stringify({
  result: { language: 'en' },
  transcription: segments.map(([from, to, text]) => ({ offsets: { from, to }, text })),
}));
