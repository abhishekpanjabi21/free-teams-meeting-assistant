// The instructions we give the AI, shared by:
//  - the Claude API (one-click mode, needs an API key), and
//  - copy-paste mode (free: you paste the prompt into Claude or Gemini yourself).

const STAGES = ['Discovery', 'Demo', 'Evaluation', 'Negotiation', 'Closing', 'Account management', 'Internal', 'Unknown'];

const RULES = `You are an expert meeting analyst and B2B sales coach. You write accurate Minutes of Meeting (MoM) and sales notes for the person who attended the meeting.
Rules:
- Only use what is actually in the transcript. Never invent names, numbers, dates, decisions or commitments.
- If something was not discussed, return an empty list for it instead of guessing.
- Speaker labels may be generic (e.g. "Speaker", "Other participants"). Use real names only when they are clear from the conversation or the attendee list.
- The transcript may contain speech-to-text errors and mixed Hindi/English. Interpret sensibly, but write the output in clear professional English.
- Keep each bullet to one sentence. Be concise and specific.
- Action item owners: the person's name, or "Unassigned". Due dates: what was said (e.g. "Friday"), or "Not set".
- If it is not a sales conversation (e.g. an internal team meeting), set dealStage to "Internal", leave salesInsights, objections and buyingSignals empty, and use sentiment for the overall tone of the meeting.`;

const SHAPE = `{
  "summary": "3-5 sentence summary: who met, what was discussed, what was agreed",
  "meetingPurpose": "one sentence: the purpose of the meeting",
  "attendees": [{ "name": "person's name", "role": "role or company if mentioned, else empty string" }],
  "keyPoints": ["main discussion points"],
  "decisions": ["decisions that were agreed"],
  "actionItems": [{ "task": "what needs doing", "owner": "who", "due": "when" }],
  "nextSteps": ["agreed next steps"],
  "salesInsights": ["needs, pain points, budget, timeline, decision makers, competitors"],
  "objections": [{ "objection": "concern raised", "response": "how it was handled, or a suggested response", "status": "addressed or open" }],
  "buyingSignals": [{ "signal": "what indicated interest", "strength": "strong, moderate or weak" }],
  "dealStage": "one of: ${STAGES.join(', ')}",
  "sentiment": { "score": 0-100, "label": "two or three words", "reason": "one sentence" },
  "followUpEmail": { "subject": "email subject", "body": "short, friendly follow-up email from me to the other attendees" }
}`;

function formatTime(sec) {
  if (sec == null) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const MAX_TRANSCRIPT_CHARS = 400_000;

function transcriptText(meeting) {
  let text = (meeting.transcript || [])
    .map((l) => `${l.start != null ? `[${formatTime(l.start)}] ` : ''}${l.speaker}: ${l.text}`)
    .join('\n');
  if (text.length > MAX_TRANSCRIPT_CHARS) text = text.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[transcript truncated]';
  return text;
}

function meetingContext(meeting) {
  const me = process.env.MY_NAME;
  return [
    `Meeting title: ${meeting.title}`,
    meeting.account ? `Company / account: ${meeting.account}` : null,
    `Date: ${new Date(meeting.date).toDateString()}`,
    meeting.durationMin ? `Duration: about ${meeting.durationMin} minutes` : null,
    meeting.attendees?.length ? `Attendees (as entered by me): ${meeting.attendees.join(', ')}` : null,
    me ? `I am ${me}. "You" in the transcript is me.` : null,
  ].filter(Boolean).join('\n');
}

// For the Claude API (rules go in the system prompt; the output shape is a tool schema).
function buildApiPrompt(meeting) {
  return `${meetingContext(meeting)}\n\n<transcript>\n${transcriptText(meeting)}\n</transcript>\n\nAnalyse this meeting and call save_meeting_insights with your analysis.`;
}

// For copy-paste into Claude or Gemini chat.
function buildChatPrompt(meeting) {
  return `${RULES}

Analyse the meeting transcript below. Reply with ONLY one JSON code block (no other text), in exactly this shape:

${SHAPE}

${meetingContext(meeting)}

<transcript>
${transcriptText(meeting)}
</transcript>`;
}

module.exports = { RULES, STAGES, buildApiPrompt, buildChatPrompt, formatTime };
