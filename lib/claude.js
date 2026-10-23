// AI analysis. Two ways to get insights:
//  1. Claude API (one click, needs an API key in .env) - runs only on the server.
//  2. Copy-paste (free): you paste our prompt into Claude or Gemini and paste the reply back.
// Both end up in the same normalize() so the app always gets the same shape.

const { RULES, STAGES, buildApiPrompt } = require('./prompt');

const DEFAULT_MODEL = 'claude-sonnet-5-5';

class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const apiKey = () => (process.env.ANTHROPIC_API_KEY || '').trim();
const modelName = () => (process.env.CLAUDE_MODEL || DEFAULT_MODEL).trim();
const isAIConfigured = () => apiKey().length > 10 && !apiKey().includes('your-key');

const strList = { type: 'array', items: { type: 'string' } };

const INSIGHTS_TOOL = {
  name: 'save_meeting_insights',
  description: 'Save the structured analysis (minutes of meeting and sales notes) of the meeting transcript.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '3-5 sentence summary: who met, what was discussed, what was agreed.' },
      meetingPurpose: { type: 'string', description: 'One sentence: the purpose of the meeting.' },
      attendees: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' } }, required: ['name', 'role'] },
      },
      keyPoints: { ...strList, description: 'Main discussion points.' },
      decisions: { ...strList, description: 'Decisions that were agreed.' },
      actionItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: { task: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } },
          required: ['task', 'owner', 'due'],
        },
      },
      nextSteps: strList,
      salesInsights: { ...strList, description: 'Needs, pain points, budget, timeline, decision makers, competitors.' },
      objections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            objection: { type: 'string' },
            response: { type: 'string', description: 'How it was handled, or a suggested way to handle it.' },
            status: { type: 'string', enum: ['addressed', 'open'] },
          },
          required: ['objection', 'response', 'status'],
        },
      },
      buyingSignals: {
        type: 'array',
        items: {
          type: 'object',
          properties: { signal: { type: 'string' }, strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] } },
          required: ['signal', 'strength'],
        },
      },
      dealStage: { type: 'string', enum: STAGES },
      sentiment: {
        type: 'object',
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 100 },
          label: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['score', 'label', 'reason'],
      },
      followUpEmail: {
        type: 'object',
        properties: { subject: { type: 'string' }, body: { type: 'string' } },
        required: ['subject', 'body'],
      },
    },
    required: ['summary', 'meetingPurpose', 'attendees', 'keyPoints', 'decisions', 'actionItems', 'nextSteps',
      'salesInsights', 'objections', 'buyingSignals', 'dealStage', 'sentiment', 'followUpEmail'],
  },
};

const list = (v) => (Array.isArray(v) ? v : []);
const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const strs = (v) => list(v).map((s) => str(s)).filter(Boolean);

// Defensive clean-up so the UI always gets the shape it expects.
function normalize(raw = {}) {
  const strength = (s) => (['strong', 'moderate', 'weak'].includes(String(s).toLowerCase()) ? String(s).toLowerCase() : 'moderate');
  const stage = STAGES.find((s) => s.toLowerCase() === str(raw.dealStage).toLowerCase()) || 'Unknown';
  return {
    summary: str(raw.summary),
    meetingPurpose: str(raw.meetingPurpose),
    attendees: list(raw.attendees).map((a) => (typeof a === 'string' ? { name: a.trim(), role: '' } : { name: str(a?.name), role: str(a?.role) })).filter((a) => a.name),
    keyPoints: strs(raw.keyPoints),
    decisions: strs(raw.decisions),
    actionItems: list(raw.actionItems).map((a) => ({
      task: str(a?.task), owner: str(a?.owner) || 'Unassigned', due: str(a?.due) || 'Not set', done: false,
    })).filter((a) => a.task),
    nextSteps: strs(raw.nextSteps),
    salesInsights: strs(raw.salesInsights),
    objections: list(raw.objections).map((o) => ({
      objection: str(o?.objection), response: str(o?.response), status: String(o?.status).toLowerCase() === 'addressed' ? 'addressed' : 'open',
    })).filter((o) => o.objection),
    buyingSignals: list(raw.buyingSignals).map((b) => ({ signal: str(b?.signal), strength: strength(b?.strength) })).filter((b) => b.signal),
    dealStage: stage,
    sentiment: {
      score: Math.max(0, Math.min(100, Math.round(Number(raw.sentiment?.score) || 50))),
      label: str(raw.sentiment?.label) || 'Neutral',
      reason: str(raw.sentiment?.reason),
    },
    followUpEmail: { subject: str(raw.followUpEmail?.subject), body: str(raw.followUpEmail?.body) },
  };
}

// Reads the reply you paste back from Claude or Gemini.
function parsePastedInsights(text) {
  let t = String(text || '').trim();
  if (!t) throw new AIError('Paste the reply from Claude or Gemini first.', 400);
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1];
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AIError("That doesn't look like the AI's answer. Copy the whole reply (the code block), then paste it here.", 400);
  }
  const jsonText = t.slice(start, end + 1);
  let obj;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    try {
      // Common chat-app glitches: curly quotes and trailing commas.
      obj = JSON.parse(jsonText.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1'));
    } catch {
      throw new AIError("Couldn't read that reply. It may have been cut off. Copy the whole code block and try again, or ask the AI to reply again with only the JSON.", 400);
    }
  }
  if (!obj || typeof obj !== 'object' || (!obj.summary && !obj.actionItems)) {
    throw new AIError("The reply is missing the summary. Make sure you copied the AI's full answer.", 400);
  }
  return normalize(obj);
}

async function analyzeMeeting(meeting) {
  if (!isAIConfigured()) {
    throw new AIError('Claude API is not connected. Use the free copy-paste option instead, or add an API key (see Settings).', 400);
  }

  const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: modelName(),
        max_tokens: 8000,
        system: RULES,
        tools: [INSIGHTS_TOOL],
        tool_choice: { type: 'tool', name: INSIGHTS_TOOL.name },
        messages: [{ role: 'user', content: buildApiPrompt(meeting) }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    throw new AIError(err.name === 'TimeoutError'
      ? 'Claude took too long to respond. Please try again.'
      : 'Could not reach the Claude API. Check your internet connection and try again.');
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    if (res.status === 401) throw new AIError('Your Claude API key was rejected. Check the key in your .env file, then restart the app.');
    if (res.status === 400 && /credit/i.test(detail)) throw new AIError('Your Claude API account has no credits left. Add credits, or use the free copy-paste option.');
    if (res.status === 404) throw new AIError(`The model "${modelName()}" was not found. Check CLAUDE_MODEL in your .env file.`);
    if (res.status === 429) throw new AIError('Claude rate limit reached. Wait a minute and try again.');
    if (res.status === 529 || res.status >= 500) throw new AIError('Claude is temporarily busy. Please try again in a moment.');
    throw new AIError(`Claude API error (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (!block) throw new AIError('Claude returned an unexpected response. Please try again.');
  return normalize(block.input);
}

module.exports = { analyzeMeeting, isAIConfigured, modelName, normalize, parsePastedInsights };
