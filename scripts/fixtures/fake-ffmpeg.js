#!/usr/bin/env node
// Stand-in for ffmpeg, used only by `npm test`. Writes a dummy output file
// (the last argument) the size of a 65-second 16 kHz WAV.
const fs = require('fs');
const args = process.argv.slice(2);
const input = args[args.indexOf('-i') + 1];
if (!fs.existsSync(input)) { process.stderr.write(`${input}: No such file\n`); process.exit(1); }
fs.writeFileSync(args[args.length - 1], Buffer.alloc(44 + 32000 * 65));
