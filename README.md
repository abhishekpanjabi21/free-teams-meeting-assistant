# Free Teams Meeting Recorder for Mac

A privacy-first, local macOS application for capturing Microsoft Teams meeting audio, generating transcripts, preparing structured minutes of meeting (MoM), and drafting sales follow-ups.

## Why I Built It

As a Sales Associate conducting B2B product demonstrations, I needed a reliable way to document discussions, decisions, objections, buying signals, and next steps. Existing meeting-assistant tools can require paid subscriptions, and my demo workflow sometimes made it difficult to download Teams recordings.

I designed this project to explore how a business problem could be translated into a practical software solution without relying on a cloud-hosted meeting bot or paid transcription services.

## Features

- **Meeting capture:** Records microphone and Teams audio on separate tracks.
- **Automatic recording:** Starts recording when Teams audio is detected and stops after a configurable period of silence, ignoring short sounds such as ringtones.
- **Local transcription:** Uses Whisper through `whisper.cpp` on Apple Silicon to transcribe audio on-device.
- **Speaker echo handling:** Detects and removes cases where meeting audio is recaptured by the microphone.
- **Structured meeting notes:** Generates attendees, meeting purpose, discussion points, decisions, action items, and next steps.
- **Sales intelligence:** Produces summaries of objections, buying signals, deal stage, and sentiment.
- **Follow-up drafting:** Creates follow-up email drafts that can be copied into Outlook.
- **Flexible AI workflow:** Supports manual copy-and-paste workflows with existing AI subscriptions and optional Claude API integration.
- **Transcript and recording imports:** Supports Teams `.vtt` transcripts and audio/video files.
- **Privacy and security:** Keeps recordings on the local machine, sends transcript text to an AI service only when explicitly requested, and uses localhost-only access controls.

## Technology

- Node.js, HTML, CSS, and JavaScript
- Web Audio API, AudioWorklet, and MediaRecorder
- `ffmpeg` and `whisper.cpp`
- BlackHole virtual audio driver
- Claude API with structured output
- macOS `launchd`
- 23 automated tests

## How It Was Built

I developed the project in one day using Claude as an AI pair-programmer. My contribution focused on defining the problem and requirements, making key product and architecture decisions, following implementation instructions, and testing the resulting application on Microsoft Teams calls. Claude generated most of the code.

This was an exploration of AI-assisted software development from a business and product perspective, rather than a claim of independently writing production software.

## Design Decisions

- **Local capture instead of a meeting bot:** Avoided the need for paid cloud hosting and meeting-bot administration approval.
- **Local-first transcription:** Used on-device Whisper to avoid paying for a transcription API.
- **Explicit AI processing:** Kept recordings local and made sending transcript text to an external AI service an intentional user action.
- **Simple technology stack:** Used Node.js built-in capabilities and browser APIs to minimize external dependencies.

## Getting Started

Requires macOS on Apple Silicon, Node.js 18+, and Google Chrome.

```bash
npm start            # run the app, then open http://localhost:3000
npm run setup        # one-time: download the Whisper model (after `brew install ffmpeg whisper-cpp`)
npm test             # run the automated checks
```

Full installation, audio setup (BlackHole) and usage instructions are in **[SETUP.md](SETUP.md)**.

## Project Status

Personal project. Tested with Microsoft Teams on macOS. The application and its limitations should be evaluated in the intended macOS environment before relying on it for business-critical meetings.

## Limitations and Responsible Use

Recording meetings may require participant consent and must comply with applicable laws, company policies, and organizational rules. Local recording does not automatically guarantee security. AI-generated notes and sales insights can be inaccurate and should be reviewed before sharing.
