# Setup & User Guide

A free, personal meeting assistant for Microsoft Teams that runs on your Mac.

- **Record** a Teams call (your voice + the other people) or **upload** a recording or Teams transcript.
- **Transcribe** it on your Mac with Whisper: free, private, no internet needed.
- **Create Minutes of Meeting (MoM)**, action items, decisions and sales insights using Claude or Gemini
  through your existing subscription (free copy-paste), or one-click with a Claude API key (optional, paid).
- **Copy or email the MoM** straight into Outlook or Teams.

Everything is stored as plain files on your Mac, in the `data/` folder.

---

## Updating to a new version

Your meetings (`data`), the Whisper model (`models`) and your settings (`.env`) are kept by moving them into the new version:
1. Stop the app (`Ctrl + C` in its Terminal window; or `npm run autostart:off` if you use auto-start).
2. Run, from Terminal:
   ```bash
   cd ~/Documents
   mv meeting-assistant meeting-assistant-old
   unzip -q ~/Downloads/meeting-assistant.zip
   mv meeting-assistant-old/data meeting-assistant-old/models meeting-assistant-old/.env meeting-assistant/
   ```
   (If it says `.env` doesn't exist, that's fine.)
3. Start it again (`cd meeting-assistant` then `npm start`, or `npm run autostart`).
4. Once everything works, delete the `meeting-assistant-old` folder.

---

## 1. Install Node.js (one time)

Open **Terminal** (`⌘ Space`, type `Terminal`, Enter) and run `node --version`.
If it says `command not found`, install the **LTS** version from **https://nodejs.org**, then reopen Terminal.

## 2. Start the app

```bash
cd ~/Documents/meeting-assistant
npm start
```

Then open **http://localhost:3000** in **Google Chrome**. (Chrome is best for recording; everything else works in Safari too.)

Keep the Terminal window open while you use the app. `Ctrl + C` stops it.

## 3. Set up free transcription (one time, ~15 minutes)

### 3a. Install Homebrew (the Mac's free app installer for developer tools)

Check if you already have it: `brew --version`. If not, run:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It asks for your Mac password (typing won't show anything, that's normal). **When it finishes, it prints
"Next steps" with two or three commands. Copy and run those**, then close and reopen Terminal.

### 3b. Install ffmpeg and Whisper

```bash
brew install ffmpeg whisper-cpp
```

### 3c. Download the Whisper model (~550 MB)

```bash
cd ~/Documents/meeting-assistant
npm run setup
```

Restart the app (`Ctrl + C`, then `npm start`). **Settings** in the app should show three green ticks.

## 4. Let the app hear the other people (one time)

Your Mac doesn't let apps record another app's sound. **BlackHole** is a free tool that fixes this.

1. Install it, then **restart your Mac**:
   ```bash
   brew install --cask blackhole-2ch
   ```
2. Open **Audio MIDI Setup** (`⌘ Space`, type "Audio MIDI"). Click **+** (bottom left) → **Create Multi-Output Device**.
   Tick **MacBook Air Speakers** (or your headphones) and **BlackHole 2ch**, and choose the speakers/headphones as **Primary Device**. Tick **Drift Correction** next to BlackHole.
3. In **Teams** → Settings → **Devices** → **Speaker**, choose **Multi-Output Device**. Leave the microphone as it is.
   (Only Teams' sound is sent to the recorder; the rest of your Mac is unaffected.)
4. In the app's **Record meeting** page, "Meeting audio" should show **BlackHole 2ch**. Play something in a Teams
   test call ("Make a test call" in Teams' device settings) and watch the bar move.

The first time you record, Chrome (and possibly macOS) will ask for microphone permission. Click **Allow**.
If you missed it: System Settings → Privacy & Security → Microphone → turn on Google Chrome.

**Headphones are optional.** Without them your mic also hears the other people through the speakers; the app detects those echoes and removes them from your side of the transcript.

## 5. Using it

**Record a meeting**
1. Join the Teams call as usual.
2. In the app: **Record meeting** → fill in title and attendees (you can do this during the call) → press the red button.
3. When the call ends, press **Stop**. Transcription runs on your Mac (roughly 1–3 minutes per 30 minutes of audio).

**Or let it record automatically**
On the **Record meeting** page, switch on **Auto-record Teams calls**. While the app is open in Chrome, it listens to the
Teams audio: when a call starts it begins recording, and once the call has been quiet for 15 minutes (changeable on the Record page) it stops and transcribes.
Sounds shorter than 20 seconds (ringtones, notifications) are ignored. Tips:
- Keep the app's Chrome tab open: right-click the tab → **Pin**, so it's always there.
- After opening Chrome, you may need to click once on the app page to activate it (the sidebar says "Auto-record paused").
- Allow Chrome notifications for the app to get a pop-up when recording starts and stops.
- Auto-recordings are named like "Teams call 23 Oct, 3:15 PM". Rename and add attendees when you create the MoM.

**Or upload** a Teams recording (.mp4) or any audio file with **Import file**.

**Create the MoM**
1. Open the meeting → **Create MoM**.
2. **Copy prompt** → **Open Claude** (or Gemini) → paste → send.
3. Copy the AI's reply (the code block) → paste it back into the app → **Save MoM**.
4. On the **Minutes (MoM)** tab: **Copy MoM** (pastes nicely into Outlook, Teams or Word), or **Email MoM**.

**Please tell participants you're recording** and follow your company's rules for recording calls.

## 6. Start the app automatically when your Mac starts

So you never have to run `npm start`:
```bash
cd ~/Documents/meeting-assistant
npm run autostart
```
(Stop the app in its Terminal window first.) From now on it runs in the background whenever you're logged in. Just open
**http://localhost:3000** in Chrome. Turn it off with `npm run autostart:off`. Logs go to `data/app.log`.
If macOS asks whether "node" may access your Documents folder, click **Allow**.

## 7. Optional: one-click AI with a Claude API key

Skip the copy-paste by adding Claude API credits:
1. Buy credits and create a key at **https://console.anthropic.com** (starts with `sk-ant-`).
2. `cp .env.example .env` then `open -e .env`, paste the key after `ANTHROPIC_API_KEY=`, save.
3. Restart the app. Meetings now also show a **One-click** button.

Never paste your key anywhere except the `.env` file.

## Settings file (.env)

Create it with `cp .env.example .env`, edit with `open -e .env`, then restart the app.

| Setting | What it does |
|---|---|
| `MY_NAME` | Your name. Used instead of "You" in transcripts and MoMs. **Recommended.** |
| `WHISPER_LANGUAGE` | `en` (default, best for English meetings), `hi` for Hindi, or `auto`. |
| `ANTHROPIC_API_KEY` | Optional, for one-click AI. |
| `PORT` | Change if 3000 is busy. |

## Check that everything works

```bash
npm test
```

Runs 23 automatic checks with stand-ins for Whisper and the Claude API. It never touches your real meetings and costs nothing.

## Where things live

| What | Where |
|---|---|
| Meetings | `data/meetings/*.json` |
| Recordings | `data/recordings/<meeting>/` |
| Imported transcript files | `data/transcripts/` |
| Whisper model | `models/` |
| Your settings / API key | `.env` (never sent to the browser) |

Back up your meetings by copying the `data` folder.

## Troubleshooting

- **"Meeting audio" bar doesn't move:** Teams' speaker must be set to **Multi-Output Device**, and BlackHole must be ticked inside it (step 4).
- **You can't hear Teams after setting it up:** in Audio MIDI Setup, make sure your headphones are ticked in the Multi-Output Device. Note that the volume keys don't control a Multi-Output Device; use the volume slider in Teams instead.
- **Transcription failed / not set up:** open **Settings** in the app. It shows what's missing. Fix it, restart the app, then press **Retry** on the meeting.
- **Hindi or Hinglish meetings come out wrong:** set `WHISPER_LANGUAGE=auto` (or `hi`) in `.env`.
- **Page closed during recording:** everything up to that moment was saved. Open the meeting and press **Transcribe saved audio**.
- **Auto-record didn't start:** the app's Chrome tab must be open, the sidebar should say "Auto-record on", and Teams' speaker must be the Multi-Output Device.
- **Port 3000 already in use:** the app is already running in another Terminal window, or use `PORT=3001 npm start`.

## How it's built

```
server.js             Local web server + API (only listens on your Mac)
lib/store.js          Saves meetings as JSON files
lib/transcript.js     Reads Teams .vtt and text transcripts
lib/transcribe.js     Recording → ffmpeg → Whisper → transcript (runs in the background)
lib/media.js          Finds ffmpeg, Whisper and the model
lib/prompt.js         The instructions given to Claude/Gemini
lib/claude.js         Claude API (optional) + reading pasted AI replies
public/               The dashboard: index.html, styles.css, app.js
scripts/setup.js      Downloads the Whisper model (npm run setup)
scripts/autostart.js  Start at login (npm run autostart / autostart:off)
scripts/smoke-test.js Automated checks (npm test)
```
