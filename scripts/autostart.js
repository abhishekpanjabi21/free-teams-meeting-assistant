// Start Meeting Assistant automatically when you log in to your Mac (macOS only).
//   npm run autostart       turn it on (also starts the app right now)
//   npm run autostart:off   turn it off
//   npm run autostart:status
// It uses macOS's built-in "launchd", the same thing Mac apps use to run at login.
// Logs go to data/app.log.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = 'com.meeting-assistant.app';
const ROOT = path.resolve(__dirname, '..');
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG = path.join(ROOT, 'data', 'app.log');
const domain = `gui/${process.getuid ? process.getuid() : ''}`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function launchctl(args, quiet = false) {
  try {
    return execFileSync('launchctl', args, { stdio: quiet ? 'ignore' : 'pipe' })?.toString() || '';
  } catch (err) {
    if (!quiet) throw err;
    return null;
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(true)).once('listening', () => s.close(() => resolve(false)));
    s.listen(port, '127.0.0.1');
  });
}

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(ROOT, 'server.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`;
}

async function on() {
  const isLoaded = launchctl(['print', `${domain}/${LABEL}`], true) !== null;
  if (!isLoaded && await portInUse(Number(process.env.PORT) || 3000)) {
    console.log('\n  The app is already running in a Terminal window.');
    console.log('  Stop it first (click that window and press Ctrl+C), then run  npm run autostart  again.\n');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  launchctl(['bootout', `${domain}/${LABEL}`], true);
  fs.writeFileSync(PLIST, plist());
  launchctl(['bootstrap', domain, PLIST]);
  console.log('\n  ✓ Meeting Assistant now starts automatically when you log in, and is running now.');
  console.log('    Open http://localhost:3000 in Chrome. You no longer need to run npm start.');
  console.log(`    Logs: ${LOG}`);
  console.log('    To turn this off:  npm run autostart:off\n');
}

function off() {
  launchctl(['bootout', `${domain}/${LABEL}`], true);
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
  console.log('\n  ✓ Auto-start is off and the background app has stopped. Use  npm start  as before.\n');
}

function status() {
  const loaded = launchctl(['print', `${domain}/${LABEL}`], true) !== null;
  console.log(`\n  Auto-start: ${fs.existsSync(PLIST) ? 'on' : 'off'}${loaded ? ' (running in the background)' : ''}\n`);
}

if (process.platform !== 'darwin') {
  console.log('Auto-start is only available on macOS.');
  process.exit(1);
}
const cmd = process.argv[2] || 'on';
({ on, off, status }[cmd] || on)().catch?.((err) => { console.error(`\n  Could not set up auto-start: ${err.message}\n`); process.exit(1); });
