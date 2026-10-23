// Meeting Assistant — dashboard (runs in your browser).
// It only talks to the local server at /api/... and never sees any API key.

const state = {
  status: null,        // { aiConfigured, model, media: {ready,...}, myName, dataDir }
  meetings: [],
  filter: 'all',
  query: '',
  autoProcessId: null, // meeting to analyse with the API right after import
  pollTimer: null,
};

// ---------- Small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 8000 : 3500);
}

async function copyText(text, okMessage = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
    return true;
  } catch {
    toast('Could not copy automatically. Select the text and press ⌘C.', 'error');
    return false;
  }
}

const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(iso).toLocaleDateString(undefined, opts);
const fmtTimeOfDay = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function fmtClock(sec) {
  if (sec == null) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const initials = (name = '?') => name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
const AVATAR_COLORS = ['#5b5fc7', '#0f9d8a', '#d9622b', '#c2417a', '#2f80d1', '#7a55c9', '#3c9a3f', '#b8860b'];
function colorFor(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const avatar = (name) => `<span class="avatar" style="background:${colorFor(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;

function avatars(people = [], max = 4) {
  const shown = people.slice(0, max).map((p) => avatar(p.name)).join('');
  const more = people.length > max ? `<span class="avatar avatar-more">+${people.length - max}</span>` : '';
  return `<div class="avatars">${shown}${more}</div>`;
}

function sentimentTone(score) {
  if (score >= 70) return 'green';
  if (score >= 45) return 'amber';
  return 'red';
}

function statusBadge(m) {
  switch (m.status) {
    case 'processed': return '';
    case 'processing': return '<span class="badge badge-blue"><span class="spinner" style="width:10px;height:10px"></span>Analysing</span>';
    case 'recording': return rec.meetingId === m.id ? '<span class="badge badge-red"><span class="dot"></span>Recording</span>' : '<span class="badge badge-red">Recording interrupted</span>';
    case 'transcribing': return `<span class="badge badge-blue"><span class="spinner" style="width:10px;height:10px"></span>Transcribing${m.progress ? ` ${m.progress.percent}%` : ''}</span>`;
    case 'transcribe_failed': return '<span class="badge badge-red">Transcription failed</span>';
    default: return '<span class="badge badge-amber"><span class="dot"></span>Needs MoM</span>';
  }
}

const MEDIA_EXTS = ['mp3', 'm4a', 'mp4', 'mov', 'm4v', 'wav', 'webm', 'aac', 'ogg', 'oga', 'opus', 'mkv', 'flac', 'wma', 'avi'];
const isMediaFile = (name) => MEDIA_EXTS.includes((name.split('.').pop() || '').toLowerCase());

// Inline icons (kept tiny so we don't need an icon library)
const ICONS = {
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>',
  wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h0"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
};

// ---------- Sidebar ----------
function renderAiPill() {
  const s = state.status;
  if (!s) return;
  const transcription = s.media?.ready ? 'Transcription ready' : 'Transcription not set up';
  $('#ai-status-pill').innerHTML = s.aiConfigured
    ? `<a class="ai-pill" href="#/settings"><span class="dot dot-green"></span><span><strong>Claude API connected</strong>${esc(transcription)}</span></a>`
    : `<a class="ai-pill" href="#/settings"><span class="dot ${s.media?.ready ? 'dot-green' : 'dot-amber'}"></span><span><strong>Free mode</strong>${esc(transcription)} · AI via copy-paste</span></a>`;
}

function setActiveNav(name) {
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

// ---------- Router ----------
async function route() {
  clearTimeout(state.pollTimer);
  const hash = location.hash.slice(1) || '/';
  const detail = hash.match(/^\/meeting\/([a-z0-9-]+)$/);
  window.scrollTo(0, 0);
  $('#view').onclick = null;
  if (rec.preview && hash !== '/record') stopPreview();
  if (detail) { setActiveNav('meetings'); return renderMeeting(detail[1]); }
  if (hash === '/settings') { setActiveNav('settings'); return renderSettings(); }
  if (hash === '/record') { setActiveNav('record'); return renderRecord(); }
  setActiveNav('meetings');
  return renderMeetings();
}

// ---------- Meetings page ----------
async function renderMeetings() {
  const view = $('#view');
  view.innerHTML = `
    <div class="page-head"><div><h1>Meetings</h1><p>Your meetings, minutes and insights.</p></div></div>
    <div class="stats">${'<div class="card skeleton" style="height:82px"></div>'.repeat(4)}</div>
    <div class="meeting-list">${'<div class="card skeleton" style="height:96px"></div>'.repeat(3)}</div>`;

  try {
    state.meetings = await api('/meetings');
  } catch (err) {
    view.innerHTML = `<div class="card empty"><h3>Couldn't load meetings</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  const ms = state.meetings;
  const processed = ms.filter((m) => m.sentiment);
  const avgSentiment = processed.length ? Math.round(processed.reduce((s, m) => s + m.sentiment.score, 0) / processed.length) : null;
  const openActions = ms.reduce((s, m) => s + (m.actionItemsOpen || 0), 0);
  const pending = ms.filter((m) => m.status !== 'processed').length;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Meetings</h1><p>Your meetings, minutes and insights.</p></div>
      <div class="head-actions">
        <button class="btn" data-action="open-import">${ICONS.upload} Import file</button>
        <a class="btn btn-primary" href="#/record">${ICONS.mic} Record meeting</a>
      </div>
    </div>

    <div class="stats">
      ${stat('icon-accent', ICONS.calendar, ms.length, 'Meetings saved')}
      ${stat('icon-amber', ICONS.sparkles, pending, 'Waiting for MoM')}
      ${stat('icon-blue', ICONS.check, openActions, 'Open action items')}
      ${stat(`icon-${avgSentiment == null ? 'green' : sentimentTone(avgSentiment)}`, ICONS.heart, avgSentiment == null ? '–' : avgSentiment, 'Avg. meeting sentiment')}
    </div>

    <div class="toolbar">
      <label class="search">${ICONS.search}<input class="input" id="search" type="search" placeholder="Search meetings, companies, people…" value="${esc(state.query)}" /></label>
      <div class="segmented" id="filter">
        ${['all', 'processed', 'pending'].map((f) => `<button data-filter="${f}" class="${state.filter === f ? 'active' : ''}">${{ all: 'All', processed: 'With MoM', pending: 'Needs MoM' }[f]}</button>`).join('')}
      </div>
    </div>
    <div class="meeting-list" id="meeting-list"></div>`;

  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderMeetingList(); });
  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    $$('#filter button').forEach((x) => x.classList.toggle('active', x === b));
    renderMeetingList();
  });
  renderMeetingList();
  pollListWhileTranscribing();
}

// Refresh the list while recordings are being transcribed.
function pollListWhileTranscribing() {
  if (!state.meetings.some((m) => m.status === 'transcribing')) return;
  state.pollTimer = setTimeout(async () => {
    if ((location.hash || '#/') !== '#/' && location.hash !== '') return;
    try { state.meetings = await api('/meetings'); renderMeetingList(); } catch { /* try again next time */ }
    pollListWhileTranscribing();
  }, 3000);
}

function stat(iconClass, icon, value, label) {
  return `<div class="card stat"><div class="icon ${iconClass}">${icon}</div><div><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div></div>`;
}

function placeholderSummary(m) {
  if (m.summary) return m.summary;
  if (m.status === 'transcribing') return `Transcribing on your Mac${m.progress ? `: ${m.progress.stage.toLowerCase()}` : ''}…`;
  if (m.status === 'recording') return rec.meetingId === m.id ? 'Recording in progress.' : 'The recording stopped unexpectedly. Open it to transcribe what was saved.';
  if (m.status === 'transcribe_failed') return 'Transcription failed. Open it to see why and retry.';
  return 'Transcript ready. Open it to create the minutes of meeting.';
}

function renderMeetingList() {
  const list = $('#meeting-list');
  if (!list) return;
  const q = state.query.trim().toLowerCase();
  const rows = state.meetings.filter((m) => {
    if (state.filter === 'processed' && m.status !== 'processed') return false;
    if (state.filter === 'pending' && m.status === 'processed') return false;
    if (!q) return true;
    const hay = [m.title, m.account, m.summary, m.dealStage, ...(m.participants || []).map((p) => p.name)].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (!state.meetings.length) {
    list.innerHTML = `<div class="card empty"><h3>No meetings yet</h3><p>Record a meeting, or import a recording or Teams transcript.</p><a class="btn btn-primary" href="#/record">${ICONS.mic} Record meeting</a></div>`;
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<div class="card empty"><h3>No matches</h3><p>Try a different search or filter.</p></div>';
    return;
  }

  list.innerHTML = rows.map((m) => {
    const d = new Date(m.date);
    const sub = [fmtTimeOfDay(m.date), m.durationMin ? `${m.durationMin} min` : null, m.participants.length ? `${m.participants.length} people` : null, m.hasAudio ? 'Recording' : null, m.sample ? 'Sample' : null].filter(Boolean);
    const sentiment = m.sentiment ? `<span class="badge badge-${sentimentTone(m.sentiment.score)}">${esc(m.sentiment.label)} · ${m.sentiment.score}</span>` : '';
    const stage = m.dealStage && !['Unknown', 'Internal'].includes(m.dealStage) ? `<span class="badge badge-muted">${esc(m.dealStage)}</span>` : '';
    return `
      <a class="card meeting-row" href="#/meeting/${esc(m.id)}">
        <div class="date-tile"><span class="mon">${d.toLocaleDateString(undefined, { month: 'short' })}</span><span class="day">${d.getDate()}</span></div>
        <div>
          <div class="row-title">${esc(m.title)}${m.account ? `<span class="account">· ${esc(m.account)}</span>` : ''}</div>
          <div class="row-sub">${sub.map(esc).join('<span>·</span>')}</div>
          <p class="row-summary">${esc(placeholderSummary(m))}</p>
        </div>
        <div class="row-meta">
          <div class="row-badges">${statusBadge(m)}${stage}${sentiment}</div>
          ${avatars(m.participants)}
        </div>
      </a>`;
  }).join('');
}

// ---------- Meeting details page ----------
async function renderMeeting(id, tab) {
  const view = $('#view');
  if (!$('#tabs')) view.innerHTML = '<div class="skeleton" style="height:28px;width:40%;margin-bottom:16px"></div><div class="card skeleton" style="height:320px"></div>';

  let m;
  try {
    m = await api(`/meetings/${id}`);
  } catch (err) {
    view.innerHTML = `<div class="card empty"><h3>Meeting not found</h3><p>${esc(err.message)}</p><a class="btn" href="#/">Back to meetings</a></div>`;
    return;
  }

  const ins = m.insights;
  const meta = [
    `<span>${ICONS.calendar}${esc(fmtDate(m.date))} · ${esc(fmtTimeOfDay(m.date))}</span>`,
    m.durationMin ? `<span>${ICONS.clock}${m.durationMin} min</span>` : '',
    m.participants.length ? `<span>${ICONS.users}${m.participants.length} participants</span>` : '',
    m.sample ? '<span class="badge badge-muted">Sample data</span>' : '',
  ].join('');
  const hasTranscript = m.transcript.length > 0;
  const defaultTab = tab || (ins ? 'mom' : 'transcript');

  view.innerHTML = `
    <div class="crumbs"><a href="#/">Meetings</a><span>/</span><span>${esc(m.title)}</span></div>
    <div class="detail-head">
      <div>
        <h1>${esc(m.title)}${m.account ? ` <span class="account">· ${esc(m.account)}</span>` : ''}</h1>
        <div class="meta">${meta}</div>
      </div>
      <div class="head-actions">
        ${ins ? `<button class="btn btn-sm" data-action="open-ai">${ICONS.sparkles} Redo MoM</button>` : ''}
        ${hasTranscript ? `<button class="btn btn-sm" data-action="export">${ICONS.download} Export</button>` : ''}
        <button class="btn btn-sm btn-ghost btn-danger" data-action="delete">${ICONS.trash} Delete</button>
      </div>
    </div>
    ${renderCallout(m)}
    ${hasTranscript ? `
    <div class="tabs" id="tabs">
      ${ins ? '<button data-tab="mom">Minutes (MoM)</button><button data-tab="insights">Insights &amp; actions</button>' : ''}
      <button data-tab="transcript">Transcript <span class="muted-note">(${m.transcript.length})</span></button>
      ${ins?.followUpEmail?.body ? '<button data-tab="email">Follow-up email</button>' : ''}
    </div>
    <div id="tab-body"></div>` : ''}`;

  const showTab = (name) => {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    const body = $('#tab-body');
    if (name === 'transcript') body.innerHTML = renderTranscriptTab(m);
    else if (name === 'email') body.innerHTML = renderEmailTab(m);
    else if (name === 'insights') body.innerHTML = renderInsightsTab(m);
    else body.innerHTML = renderMomTab(m);
    wireTab(m, name);
  };
  if (hasTranscript) {
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
    showTab($(`#tabs [data-tab="${defaultTab}"]`) ? defaultTab : 'transcript');
  }

  view.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'process') processWithApi(m.id, btn);
    if (action === 'open-ai') openCopyPaste(m);
    if (action === 'export') exportMarkdown(m);
    if (action === 'delete') deleteMeeting(m);
    if (action === 'retry-transcribe') {
      try { await api(`/meetings/${m.id}/transcribe`, { method: 'POST', body: {} }); renderMeeting(m.id); } catch (err) { toast(err.message, 'error'); }
    }
    if (action === 'finish-saved') {
      try { await api(`/meetings/${m.id}/finish`, { method: 'POST', body: {} }); renderMeeting(m.id); } catch (err) { toast(err.message, 'error'); }
    }
    if (action === 'copy-email') {
      const em = m.insights.followUpEmail;
      copyText(`Subject: ${em.subject}\n\n${em.body}`, 'Email copied');
    }
    if (action === 'copy-mom') copyMom(m);
    if (action === 'email-mom') emailMom(m);
  };

  // Keep checking while the recording is being transcribed.
  if (m.status === 'transcribing') {
    state.pollTimer = setTimeout(() => {
      if (location.hash === `#/meeting/${id}`) refreshTranscribing(id);
    }, 2500);
  }

  if (state.autoProcessId === m.id && m.status === 'pending') {
    state.autoProcessId = null;
    const btn = $('[data-action="process"]');
    if (btn) processWithApi(m.id, btn);
  }
}

async function refreshTranscribing(id) {
  try {
    const m = await api(`/meetings/${id}`);
    if (m.status === 'transcribing') {
      const bar = $('#transcribe-progress');
      if (bar) {
        bar.style.width = `${m.progress?.percent || 0}%`;
        $('#transcribe-stage').textContent = `${m.progress?.stage || 'Working'}… ${m.progress?.percent || 0}%`;
      }
      state.pollTimer = setTimeout(() => { if (location.hash === `#/meeting/${id}`) refreshTranscribing(id); }, 2500);
    } else {
      if (m.status === 'pending') toast('Transcript ready');
      renderMeeting(id);
    }
  } catch {
    state.pollTimer = setTimeout(() => refreshTranscribing(id), 5000);
  }
}

function renderCallout(m) {
  if (m.status === 'recording') {
    if (rec.meetingId === m.id) {
      return `<div class="callout"><div class="icon" style="background:#e0484f"><span class="rec-dot" style="background:#fff"></span></div><div class="grow"><h3>Recording in progress</h3><p>Stop the recording to transcribe it.</p></div><a class="btn btn-primary" href="#/record">Go to recorder ${ICONS.arrow}</a></div>`;
    }
    return `<div class="callout error"><div class="icon">${ICONS.alert}</div><div class="grow"><h3>This recording stopped unexpectedly</h3><p>The page was closed or reloaded while recording. Everything up to that point was saved.</p></div><div class="btns"><button class="btn btn-primary" data-action="finish-saved">Transcribe saved audio</button></div></div>`;
  }
  if (m.status === 'transcribing') {
    const p = m.progress || { stage: 'Waiting to start', percent: 0 };
    return `<div class="callout"><div class="icon"><span class="spinner"></span></div><div class="grow"><h3>Transcribing on your Mac</h3><p id="transcribe-stage">${esc(p.stage)}… ${p.percent}%</p><div class="progress"><i id="transcribe-progress" style="width:${p.percent}%"></i></div><p class="hint">This takes roughly 1–3 minutes per 30 minutes of audio. You can keep using the app.</p></div></div>`;
  }
  if (m.status === 'transcribe_failed') {
    return `<div class="callout error"><div class="icon">${ICONS.alert}</div><div class="grow"><h3>Transcription didn't finish</h3><p>${esc(m.lastError || 'Unknown error')}</p></div><div class="btns"><a class="btn" href="#/settings">Settings</a><button class="btn btn-primary" data-action="retry-transcribe">${ICONS.retry} Retry</button></div></div>`;
  }
  if (m.status === 'processing') {
    return '<div class="callout"><div class="icon"><span class="spinner"></span></div><div class="grow"><h3>Claude is analysing this meeting…</h3><p>This usually takes 20–60 seconds.</p></div></div>';
  }
  const errorNote = m.lastError ? `<div class="callout error"><div class="icon">${ICONS.alert}</div><div class="grow"><h3>Last analysis didn't finish</h3><p>${esc(m.lastError)}</p></div></div>` : '';
  if (m.insights || !m.transcript.length) return errorNote;
  const apiBtn = state.status?.aiConfigured ? `<button class="btn" data-action="process">${ICONS.sparkles} One-click (Claude API)</button>` : '';
  return `${errorNote}<div class="callout"><div class="icon">${ICONS.doc}</div><div class="grow"><h3>Transcript ready. Create the minutes</h3><p>Get the MoM, action items, decisions and sales insights using Claude or Gemini (free with your subscription).</p></div><div class="btns">${apiBtn}<button class="btn btn-primary" data-action="open-ai">${ICONS.sparkles} Create MoM</button></div></div>`;
}

function card(title, iconClass, icon, inner, count) {
  return `<section class="card card-pad"><h3 class="card-title"><span class="icon ${iconClass}">${icon}</span>${esc(title)}${count != null ? `<span class="count">${count}</span>` : ''}</h3>${inner}</section>`;
}

const emptyNote = (text) => `<p class="muted-note">${esc(text)}</p>`;

// --- Minutes of meeting ---
function momAttendees(m) {
  const fromAi = m.insights?.attendees || [];
  const names = new Map();
  for (const p of m.participants || []) {
    if (!/^(other participants|speaker|unknown speaker)$/i.test(p.name)) names.set(p.name.toLowerCase(), { name: p.name, role: p.role || '' });
  }
  for (const a of fromAi) {
    const key = a.name.toLowerCase();
    if (!names.has(key)) names.set(key, a);
    else if (!names.get(key).role && a.role) names.get(key).role = a.role;
  }
  return [...names.values()];
}

function momData(m) {
  const ins = m.insights;
  return {
    title: `${m.title}${m.account ? ` — ${m.account}` : ''}`,
    date: fmtDate(m.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    time: fmtTimeOfDay(m.date),
    duration: m.durationMin ? `${m.durationMin} minute${m.durationMin === 1 ? '' : 's'}` : '',
    attendees: momAttendees(m).map((a) => (a.role ? `${a.name} (${a.role})` : a.name)),
    purpose: ins.meetingPurpose,
    summary: ins.summary,
    points: ins.keyPoints,
    decisions: ins.decisions || [],
    actions: ins.actionItems,
    next: ins.nextSteps,
  };
}

function renderMomTab(m) {
  const d = momData(m);
  const list = (items, ordered) => (items.length ? `<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : emptyNote('None recorded.'));
  return `
    <div class="mom-toolbar">
      <button class="btn btn-sm btn-primary" data-action="copy-mom">${ICONS.copy} Copy MoM</button>
      <button class="btn btn-sm" data-action="email-mom">${ICONS.mail} Email MoM</button>
      <button class="btn btn-sm" data-action="export">${ICONS.download} Download</button>
    </div>
    <article class="card mom">
      <h2>Minutes of Meeting</h2>
      <p class="mom-sub">${esc(d.title)}</p>
      <dl class="mom-meta">
        <dt>Date</dt><dd>${esc(d.date)}</dd>
        <dt>Time</dt><dd>${esc(d.time)}${d.duration ? ` · ${esc(d.duration)}` : ''}</dd>
        <dt>Attendees</dt><dd>${d.attendees.length ? esc(d.attendees.join(', ')) : '<span class="muted-note">Not recorded</span>'}</dd>
        ${d.purpose ? `<dt>Purpose</dt><dd>${esc(d.purpose)}</dd>` : ''}
      </dl>
      <h3>Summary</h3><p style="color:var(--text-2)">${esc(d.summary)}</p>
      <h3>Discussion points</h3>${list(d.points)}
      <h3>Decisions</h3>${list(d.decisions)}
      <h3>Action items</h3>
      ${d.actions.length ? `<table class="mom-table"><thead><tr><th>#</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>
        ${d.actions.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.task)}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td><td>${a.done ? '<span class="badge badge-green">Done</span>' : '<span class="badge badge-muted">Open</span>'}</td></tr>`).join('')}
      </tbody></table>` : emptyNote('No action items.')}
      <h3>Next steps</h3>${list(d.next, true)}
    </article>`;
}

function momPlainText(m) {
  const d = momData(m);
  const out = ['MINUTES OF MEETING', d.title, '', `Date: ${d.date}`, `Time: ${d.time}${d.duration ? ` (${d.duration})` : ''}`];
  if (d.attendees.length) out.push(`Attendees: ${d.attendees.join(', ')}`);
  if (d.purpose) out.push(`Purpose: ${d.purpose}`);
  out.push('', 'SUMMARY', d.summary, '');
  if (d.points.length) out.push('DISCUSSION POINTS', ...d.points.map((p) => `• ${p}`), '');
  if (d.decisions.length) out.push('DECISIONS', ...d.decisions.map((p) => `• ${p}`), '');
  if (d.actions.length) out.push('ACTION ITEMS', ...d.actions.map((a, i) => `${i + 1}. ${a.task} — Owner: ${a.owner} — Due: ${a.due}${a.done ? ' (Done)' : ''}`), '');
  if (d.next.length) out.push('NEXT STEPS', ...d.next.map((s, i) => `${i + 1}. ${s}`));
  return out.join('\n').trim();
}

function momHtml(m) {
  const d = momData(m);
  const s = 'font-family:Calibri,Arial,sans-serif;font-size:11pt;';
  const h = 'font-family:Calibri,Arial,sans-serif;font-size:12pt;font-weight:bold;margin:14px 0 6px;';
  const ul = (items) => `<ul style="${s}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const td = 'border:1px solid #bbb;padding:5px 8px;vertical-align:top;';
  return `<div style="${s}">
    <p style="font-size:15pt;font-weight:bold;margin:0">Minutes of Meeting</p>
    <p style="margin:2px 0 10px">${esc(d.title)}</p>
    <p style="margin:0"><b>Date:</b> ${esc(d.date)}<br><b>Time:</b> ${esc(d.time)}${d.duration ? ` (${esc(d.duration)})` : ''}${d.attendees.length ? `<br><b>Attendees:</b> ${esc(d.attendees.join(', '))}` : ''}${d.purpose ? `<br><b>Purpose:</b> ${esc(d.purpose)}` : ''}</p>
    <p style="${h}">Summary</p><p style="margin:0">${esc(d.summary)}</p>
    ${d.points.length ? `<p style="${h}">Discussion points</p>${ul(d.points)}` : ''}
    ${d.decisions.length ? `<p style="${h}">Decisions</p>${ul(d.decisions)}` : ''}
    ${d.actions.length ? `<p style="${h}">Action items</p><table style="border-collapse:collapse;${s}"><tr><th style="${td}">#</th><th style="${td}">Action</th><th style="${td}">Owner</th><th style="${td}">Due</th></tr>${d.actions.map((a, i) => `<tr><td style="${td}">${i + 1}</td><td style="${td}">${esc(a.task)}</td><td style="${td}">${esc(a.owner)}</td><td style="${td}">${esc(a.due)}</td></tr>`).join('')}</table>` : ''}
    ${d.next.length ? `<p style="${h}">Next steps</p><ol style="${s}">${d.next.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
  </div>`;
}

async function copyMom(m) {
  const text = momPlainText(m);
  try {
    // Rich text pastes nicely into Outlook, Word and Teams; plain text is the fallback.
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([momHtml(m)], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    toast('MoM copied. Paste it into Outlook, Teams or Word');
  } catch {
    copyText(text, 'MoM copied');
  }
}

function emailMom(m) {
  const subject = `MoM: ${m.title}${m.account ? ` — ${m.account}` : ''} (${fmtDate(m.date, { day: 'numeric', month: 'short', year: 'numeric' })})`;
  const body = `Hi all,\n\nPlease find the minutes of today's meeting below.\n\n${momPlainText(m)}\n\nRegards,\n${state.status?.myName || ''}`;
  location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// --- Sales insights ---
function renderInsightsTab(m) {
  const ins = m.insights;
  if (!ins) return '<div class="card empty"><h3>No insights yet</h3><p>Create the MoM to see the analysis here.</p></div>';

  const summary = card('Summary', 'icon-accent', ICONS.sparkles,
    `<p class="summary-text">${esc(ins.summary)}</p>${ins.keyPoints.length ? `<ul class="bullets">${ins.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}`);

  const open = ins.actionItems.filter((a) => !a.done).length;
  const actions = card('Action items', 'icon-blue', ICONS.check,
    ins.actionItems.length ? `<ul class="todo">${ins.actionItems.map((a, i) => `
      <li class="${a.done ? 'done' : ''}">
        <input type="checkbox" data-action-item="${i}" ${a.done ? 'checked' : ''} aria-label="Mark done" />
        <div><div class="task">${esc(a.task)}</div><div class="who"><span>👤 ${esc(a.owner)}</span><span>📅 ${esc(a.due)}</span></div></div>
      </li>`).join('')}</ul>` : emptyNote('No action items were mentioned.'),
    ins.actionItems.length ? `${open} open` : null);

  const objections = card('Objections', 'icon-red', ICONS.shield,
    ins.objections.length ? ins.objections.map((o) => `
      <div class="objection">
        <div class="objection-head"><strong>${esc(o.objection)}</strong><span class="badge ${o.status === 'addressed' ? 'badge-green' : 'badge-amber'}">${o.status === 'addressed' ? 'Addressed' : 'Open'}</span></div>
        <p>${esc(o.response)}</p>
      </div>`).join('') : emptyNote('No objections raised.'), ins.objections.length);

  const signals = card('Buying signals', 'icon-green', ICONS.trend,
    ins.buyingSignals.length ? ins.buyingSignals.map((b) => {
      const level = { strong: 3, moderate: 2, weak: 1 }[b.strength] || 2;
      return `<div class="signal"><span>${esc(b.signal)}</span><span class="meter on-${level}" title="${esc(b.strength)}"><i></i><i></i><i></i></span></div>`;
    }).join('') : emptyNote('No clear buying signals.'), ins.buyingSignals.length);

  const insights = card('Sales insights', 'icon-amber', ICONS.bulb,
    ins.salesInsights.length ? `<ul class="bullets" style="margin-top:0">${ins.salesInsights.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : emptyNote('Nothing notable.'));

  const next = card('Next steps', 'icon-accent', ICONS.arrow,
    ins.nextSteps.length ? `<ol class="steps">${ins.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : emptyNote('No next steps agreed.'));

  const score = ins.sentiment.score;
  const tone = sentimentTone(score);
  const C = 2 * Math.PI * 38;
  const pulse = `<section class="card card-pad">
      <h3 class="card-title"><span class="icon icon-${tone}">${ICONS.heart}</span>Deal pulse</h3>
      <div class="pulse">
        <div class="ring">
          <svg width="92" height="92" viewBox="0 0 92 92"><circle cx="46" cy="46" r="38" fill="none" stroke="var(--border)" stroke-width="8"/><circle cx="46" cy="46" r="38" fill="none" stroke="var(--${tone})" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(C * score / 100).toFixed(1)} ${C.toFixed(1)}"/></svg>
          <span class="num">${score}</span>
        </div>
        <div><div class="pulse-label">${esc(ins.sentiment.label)}</div><div class="pulse-reason">${esc(ins.sentiment.reason)}</div></div>
      </div>
      <div style="margin-top:16px">
        <div class="kv"><span>Deal stage</span><span class="badge badge-accent">${esc(ins.dealStage)}</span></div>
        <div class="kv"><span>Open objections</span><strong>${ins.objections.filter((o) => o.status === 'open').length}</strong></div>
        <div class="kv"><span>Strong signals</span><strong>${ins.buyingSignals.filter((b) => b.strength === 'strong').length}</strong></div>
      </div>
    </section>`;

  return `<div class="detail-grid">
    <div class="stack">${summary}${actions}${next}${objections}${signals}${insights}</div>
    <div class="stack">${pulse}${renderPeople(m)}${renderSourceCard(m)}</div>
  </div>`;
}

function renderPeople(m) {
  const people = m.participants.length ? m.participants : momAttendees(m);
  if (!people.length) return '';
  return card('Participants', 'icon-blue', ICONS.users, `<div class="people">${people.map((p) => `
    <div class="person">${avatar(p.name)}<div><div class="person-name">${esc(p.name)}</div>${p.role || p.side ? `<div class="person-role">${esc([p.role, p.side === 'us' ? 'Your team' : p.side === 'customer' ? m.account || 'Customer' : null].filter(Boolean).join(' · '))}</div>` : ''}</div></div>`).join('')}</div>`, people.length);
}

function renderSourceCard(m) {
  const source = { sample: 'Sample meeting', upload: 'Uploaded transcript', paste: 'Pasted transcript', recording: 'Recorded in the app', 'recording-upload': 'Uploaded recording' }[m.source] || 'Imported';
  return card('Details', 'icon-accent', ICONS.file, `
    <div class="kv" style="border-top:0;padding-top:0"><span>Source</span><span>${esc(source)}</span></div>
    <div class="kv"><span>Transcript lines</span><span>${m.transcript.length}</span></div>
    ${m.processedAt ? `<div class="kv"><span>Analysed</span><span>${esc(fmtDate(m.processedAt, { day: 'numeric', month: 'short' }))}</span></div>` : ''}
    ${m.aiModel ? `<div class="kv"><span>AI</span><span>${esc(m.aiModel)}</span></div>` : ''}`);
}

function renderTranscriptTab(m) {
  const audio = m.audioFile ? `<div class="audio-bar"><audio id="player" controls preload="metadata" src="/api/meetings/${esc(m.id)}/audio"></audio></div>` : '';
  const note = m.source === 'recording-upload' ? '<p class="hint" style="margin:-4px 0 12px">Speakers in uploaded recordings aren\'t labelled. The AI works out who said what from context.</p>' : '';
  return `<div class="detail-grid">
    <section class="card card-pad">
      ${audio}${note}
      <div class="transcript-tools">
        <label class="search" style="max-width:none">${ICONS.search}<input class="input" id="t-search" type="search" placeholder="Search the transcript…" /></label>
        <span class="muted-note" id="t-count"></span>
      </div>
      <div class="transcript" id="transcript"></div>
    </section>
    <div class="stack">${renderPeople(m)}${renderSourceCard(m)}</div>
  </div>`;
}

function drawTranscript(m, q = '') {
  const box = $('#transcript');
  if (!box) return;
  const query = q.trim().toLowerCase();
  const lines = m.transcript.filter((l) => !query || l.text.toLowerCase().includes(query) || l.speaker.toLowerCase().includes(query));
  const highlight = (text) => {
    const safe = esc(text);
    if (!query) return safe;
    const pattern = new RegExp(esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return safe.replace(pattern, (x) => `<mark>${x}</mark>`);
  };
  const seekable = !!m.audioFile;
  box.innerHTML = lines.length ? lines.map((l) => `
    <div class="line">${avatar(l.speaker)}<div><div class="line-head"><strong>${esc(l.speaker)}</strong>${l.start != null ? `<time class="${seekable ? 'seek' : ''}" data-seek="${l.start}" title="${seekable ? 'Play from here' : ''}">${fmtClock(l.start)}</time>` : ''}</div><div class="line-text">${highlight(l.text)}</div></div></div>`).join('')
    : emptyNote('No lines match your search.');
  $('#t-count').textContent = query ? `${lines.length} of ${m.transcript.length} lines` : '';
}

function renderEmailTab(m) {
  const e = m.insights.followUpEmail;
  return `<section class="card card-pad" style="max-width:760px">
    <h3 class="card-title"><span class="icon icon-accent">${ICONS.inbox}</span>Draft follow-up email<button class="btn btn-sm" style="margin-left:auto" data-action="copy-email">${ICONS.copy} Copy</button></h3>
    <div class="email-subject">${esc(e.subject)}</div>
    <div class="email-body">${esc(e.body)}</div>
    <p class="hint" style="margin-top:16px">This is a draft. Review it, then send it yourself from Outlook.</p>
  </section>`;
}

function wireTab(m, name) {
  if (name === 'transcript') {
    drawTranscript(m);
    $('#t-search').addEventListener('input', (e) => drawTranscript(m, e.target.value));
    $('#transcript').addEventListener('click', (e) => {
      const t = e.target.closest('[data-seek]');
      const player = $('#player');
      if (!t || !player) return;
      player.currentTime = Number(t.dataset.seek);
      player.play().catch(() => {});
    });
  }
  if (name === 'insights') {
    $$('[data-action-item]').forEach((box) => box.addEventListener('change', async () => {
      const index = Number(box.dataset.actionItem);
      const li = box.closest('li');
      li.classList.toggle('done', box.checked);
      try {
        const updated = await api(`/meetings/${m.id}`, { method: 'PATCH', body: { actionItem: { index, done: box.checked } } });
        m.insights = updated.insights;
        const open = m.insights.actionItems.filter((a) => !a.done).length;
        const count = li.closest('section').querySelector('.count');
        if (count) count.textContent = `${open} open`;
      } catch (err) {
        box.checked = !box.checked;
        li.classList.toggle('done', box.checked);
        toast(err.message, 'error');
      }
    }));
  }
}

// ---------- AI: free copy-paste mode ----------
async function openCopyPaste(m) {
  let prompt = '';
  let source = 'AI chat (copy-paste)';
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal">
        <div class="modal-head">
          <h2>Create MoM with Claude or Gemini</h2>
          <p>Free with your existing subscription. Takes about 30 seconds.</p>
        </div>
        <div class="modal-body">
          <div class="step-box">
            <h4><span class="step-num">1</span>Copy the prompt (it includes the transcript)</h4>
            <div class="step-actions">
              <button class="btn btn-primary" id="copy-prompt" disabled><span class="spinner"></span> Preparing…</button>
              <a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener" data-src="Claude (copy-paste)">Open Claude ${ICONS.external}</a>
              <a class="btn" href="https://gemini.google.com/app" target="_blank" rel="noopener" data-src="Gemini (copy-paste)">Open Gemini ${ICONS.external}</a>
            </div>
            <p class="hint" id="prompt-size"></p>
          </div>
          <div class="step-box">
            <h4><span class="step-num">2</span>Paste it into a new chat and send</h4>
            <p class="muted-note">Wait for the full reply. It will be one block of code-looking text (JSON). Then click the copy icon on that block.</p>
          </div>
          <div class="step-box">
            <h4><span class="step-num">3</span>Paste the reply here</h4>
            <textarea class="textarea reply" id="reply" placeholder='{ "summary": "...", ... }'></textarea>
          </div>
          <div id="form-error"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" id="save-reply">Save MoM</button>
        </div>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('#backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'backdrop') close(); });
  $('[data-close]').addEventListener('click', close);
  $$('[data-src]').forEach((a) => a.addEventListener('click', () => { source = a.dataset.src; }));

  try {
    prompt = (await api(`/meetings/${m.id}/prompt`)).prompt;
    const btn = $('#copy-prompt');
    btn.disabled = false;
    btn.innerHTML = `${ICONS.copy} Copy prompt`;
    const kb = Math.round(prompt.length / 1000);
    $('#prompt-size').textContent = `${kb}k characters.${prompt.length > 150000 ? ' This is a long meeting. If the chat says the message is too long, try Gemini, which accepts longer messages.' : ''}`;
    btn.addEventListener('click', async () => {
      if (await copyText(prompt, 'Prompt copied. Now paste it into Claude or Gemini')) {
        btn.innerHTML = `${ICONS.check} Copied`;
      }
    });
  } catch (err) {
    $('#form-error').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }

  $('#save-reply').addEventListener('click', async () => {
    const btn = $('#save-reply');
    $('#form-error').innerHTML = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      await api(`/meetings/${m.id}/insights`, { method: 'POST', body: { text: $('#reply').value, source } });
      close();
      toast('MoM saved');
      renderMeeting(m.id, 'mom');
    } catch (err) {
      $('#form-error').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Save MoM';
    }
  });
}

// ---------- AI: one-click Claude API mode ----------
async function processWithApi(id, btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analysing…';
  try {
    await api(`/meetings/${id}/process`, { method: 'POST', body: {} });
    toast('MoM ready');
    if (location.hash === `#/meeting/${id}`) renderMeeting(id, 'mom');
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = original;
    if (location.hash === `#/meeting/${id}`) renderMeeting(id);
  }
}

async function deleteMeeting(m) {
  if (!confirm(`Delete "${m.title}"? This removes the meeting, its transcript and any recording from your Mac.`)) return;
  try {
    await api(`/meetings/${m.id}`, { method: 'DELETE' });
    toast('Meeting deleted');
    location.hash = '#/';
  } catch (err) {
    toast(err.message, 'error');
  }
}

function exportMarkdown(m) {
  const ins = m.insights;
  const out = [];
  if (ins) {
    out.push(...momPlainText(m).split('\n'), '', '---', '');
    if (ins.objections.length) out.push('OBJECTIONS', ...ins.objections.map((o) => `• ${o.objection} (${o.status}): ${o.response}`), '');
    if (ins.buyingSignals.length) out.push('BUYING SIGNALS', ...ins.buyingSignals.map((b) => `• ${b.signal} (${b.strength})`), '');
    if (ins.salesInsights.length) out.push('SALES INSIGHTS', ...ins.salesInsights.map((s) => `• ${s}`), '');
    if (ins.followUpEmail?.body) out.push('FOLLOW-UP EMAIL DRAFT', `Subject: ${ins.followUpEmail.subject}`, '', ins.followUpEmail.body, '');
    out.push('---', '');
  } else {
    out.push(`${m.title}${m.account ? ` — ${m.account}` : ''}`, fmtDate(m.date), '');
  }
  out.push('TRANSCRIPT', ...m.transcript.map((l) => `${l.speaker}${l.start != null ? ` [${fmtClock(l.start)}]` : ''}: ${l.text}`));

  const blob = new Blob([out.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `MoM - ${m.title.replace(/[^\w\- ]+/g, '').trim() || 'meeting'}${m.account ? ` - ${m.account.replace(/[^\w\- ]+/g, '')}` : ''}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Saved to your Downloads folder');
}

// ---------- Import modal (transcripts and recordings) ----------
function openImport() {
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  let file = null;
  let fileText = '';
  let mode = 'upload';

  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <form class="modal" id="import-form" autocomplete="off">
        <div class="modal-head">
          <h2>Import a meeting</h2>
          <p>A recording (audio or video) or a Teams transcript (.vtt). Files stay on your Mac.</p>
        </div>
        <div class="modal-body">
          <div class="segmented" id="mode">
            <button type="button" data-mode="upload" class="active">Upload file</button>
            <button type="button" data-mode="paste">Paste transcript</button>
          </div>

          <div id="upload-area">
            <label class="dropzone" id="dropzone">
              ${ICONS.upload}
              <strong>Drop a recording or transcript, or click to choose</strong>
              <div class="hint">Recordings: .mp4 .m4a .mp3 .mov .wav · Transcripts: .vtt .txt</div>
              <input type="file" id="file-input" accept=".vtt,.txt,.text,${MEDIA_EXTS.map((e) => `.${e}`).join(',')},audio/*,video/*" hidden />
            </label>
            <div id="file-chip"></div>
          </div>

          <div id="paste-area" hidden>
            <label class="label" for="paste">Transcript text</label>
            <textarea class="textarea" id="paste" placeholder="Sarah Lin: Thanks for joining…&#10;Rohan Mehta: Happy to be here…"></textarea>
            <div class="hint">Works with "Name: text" lines, or Teams' "Name 0:03" format.</div>
          </div>

          <div>
            <label class="label" for="title">Meeting title</label>
            <input class="input" id="title" placeholder="e.g. Weekly sales sync" maxlength="140" />
          </div>
          <div class="row-2">
            <div><label class="label" for="account">Company / account</label><input class="input" id="account" placeholder="Optional" maxlength="120" /></div>
            <div><label class="label" for="date">Date &amp; time</label><input class="input" id="date" type="datetime-local" value="${localDate}" /></div>
          </div>
          <div id="attendees-wrap" hidden>
            <label class="label" for="attendees">Attendees</label>
            <input class="input" id="attendees" placeholder="e.g. Priya Desai, Arjun Rao (comma separated)" />
            <div class="hint">Recordings don't include names, so this helps the AI write the MoM.</div>
          </div>
          <div id="form-error"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="import-btn">Import</button>
        </div>
      </form>
    </div>`;

  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('#backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'backdrop') close(); });
  $('[data-close]').addEventListener('click', close);

  const showError = (msg) => { $('#form-error').innerHTML = msg ? `<div class="form-error">${esc(msg)}</div>` : ''; };

  $('#mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    $$('#mode button').forEach((x) => x.classList.toggle('active', x === b));
    $('#upload-area').hidden = mode !== 'upload';
    $('#paste-area').hidden = mode !== 'paste';
    $('#attendees-wrap').hidden = !(mode === 'upload' && file && isMediaFile(file.name));
    showError('');
    if (mode === 'paste') $('#paste').focus();
  });

  async function takeFile(f) {
    showError('');
    if (!f) return;
    if (/\.docx?$/i.test(f.name)) {
      showError('Word (.docx) transcripts aren\'t supported yet. In Teams, choose "Download as .vtt" instead, or open the .docx and paste the text.');
      return;
    }
    const media = isMediaFile(f.name);
    if (!media && f.size > 15 * 1024 * 1024) { showError('That transcript file is larger than 15 MB.'); return; }
    if (media && !state.status?.media?.ready) {
      showError('Heads up: transcription isn\'t set up yet (see Settings). You can still import now and it will be transcribed once you finish setup and click Retry.');
    }
    file = f;
    fileText = media ? '' : await f.text();
    $('#dropzone').hidden = true;
    const size = f.size > 1e6 ? `${(f.size / 1e6).toFixed(1)} MB` : `${(f.size / 1024).toFixed(1)} KB`;
    $('#file-chip').innerHTML = `<div class="file-chip">${media ? ICONS.wave : ICONS.file}<span class="name">${esc(f.name)}</span><span class="muted-note">${size}</span><button type="button" class="btn btn-sm btn-ghost" id="remove-file">Change</button></div>`;
    $('#remove-file').addEventListener('click', () => { file = null; fileText = ''; $('#file-chip').innerHTML = ''; $('#dropzone').hidden = false; $('#attendees-wrap').hidden = true; });
    $('#attendees-wrap').hidden = !media;
    if (!$('#title').value) $('#title').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  $('#file-input').addEventListener('change', (e) => takeFile(e.target.files[0]));
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => takeFile(e.dataTransfer.files[0]));

  $('#import-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = $('#import-btn');
    const dateValue = $('#date').value;
    const date = dateValue ? new Date(dateValue).toISOString() : '';

    if (mode === 'upload' && file && isMediaFile(file.name)) {
      btn.disabled = true;
      try {
        const meeting = await uploadMedia(file, {
          title: $('#title').value, account: $('#account').value, date, attendees: $('#attendees').value, fileName: file.name,
        }, (pct) => { btn.innerHTML = `<span class="spinner"></span> Uploading ${pct}%`; });
        close();
        toast('Recording saved. Transcribing now');
        location.hash = `#/meeting/${meeting.id}`;
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Import';
      }
      return;
    }

    const transcriptText = mode === 'upload' ? fileText : $('#paste').value;
    if (!transcriptText.trim()) { showError(mode === 'upload' ? 'Choose a file first.' : 'Paste the transcript text first.'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Importing…';
    try {
      const meeting = await api('/meetings', {
        method: 'POST',
        body: { title: $('#title').value, account: $('#account').value, date, transcriptText, fileName: mode === 'upload' && file ? file.name : null },
      });
      close();
      toast(`Imported "${meeting.title}" (${meeting.transcript.length} lines)`);
      location.hash = `#/meeting/${meeting.id}`;
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  });
}

// Uploads a recording with a progress callback (fetch can't report upload progress).
function uploadMedia(file, fields, onProgress) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(Object.entries(fields).filter(([, v]) => v));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/media?${qs}`);
    xhr.setRequestHeader('Content-Type', /^(audio|video)\//.test(file.type) ? file.type : 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Is the app still running in Terminal?'));
    xhr.send(file);
  });
}

// ---------- Recorder ----------
// Records two separate tracks so the transcript can say who spoke:
//   "me"     = your microphone
//   "others" = the Teams audio, captured through the free BlackHole audio driver
const rec = {
  meetingId: null,
  preview: null,       // { streams, ctx, raf } while choosing devices
  session: null,       // { recorders, streams, ctx, raf, chains, startedAt, timer, failed }
  devices: [],
  micId: localStorage.getItem('rec.mic') || '',
  othersId: localStorage.getItem('rec.others') ?? 'auto',
};

const supportsRecording = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const isSafari = () => /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

function pickMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  return { mime, ext: mime.includes('mp4') ? 'mp4' : 'webm' };
}

async function getStream(deviceId, forVoice) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // Voice cleanup helps your mic; the Teams feed should be captured untouched.
      echoCancellation: forVoice,
      noiseSuppression: forVoice,
      autoGainControl: forVoice,
    },
  });
}

async function loadDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  rec.devices = all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
  return rec.devices;
}

const hasLabels = () => rec.devices.some((d) => d.label);
const blackhole = () => rec.devices.find((d) => /blackhole/i.test(d.label));
// Device ids can change between browser sessions, so fall back to the saved name.
const byLabel = (key) => {
  const label = localStorage.getItem(key);
  return label ? rec.devices.find((d) => d.label === label)?.deviceId : undefined;
};
function resolvedOthersId() {
  if (rec.othersId === 'auto') return blackhole()?.deviceId || '';
  if (rec.othersId === '') return '';
  if (rec.devices.some((d) => d.deviceId === rec.othersId)) return rec.othersId;
  return byLabel('rec.othersLabel') || blackhole()?.deviceId || '';
}
function resolvedMicId() {
  if (rec.devices.some((d) => d.deviceId === rec.micId)) return rec.micId;
  const saved = byLabel('rec.micLabel');
  if (saved) return saved;
  const preferred = rec.devices.find((d) => d.deviceId === 'default') || rec.devices.find((d) => !/blackhole|aggregate|multi-output/i.test(d.label));
  return preferred?.deviceId || '';
}

function levelLoop(ctx, streams, bars) {
  const analysers = streams.map((s) => {
    if (!s) return null;
    const a = ctx.createAnalyser();
    a.fftSize = 1024;
    ctx.createMediaStreamSource(s).connect(a);
    return a;
  });
  const buf = new Uint8Array(1024);
  let raf;
  const tick = () => {
    analysers.forEach((a, i) => {
      const bar = bars[i] && $(bars[i]);
      if (!a || !bar) return;
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      bar.style.width = `${Math.min(100, Math.round(rms * 400))}%`;
    });
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

function stopPreview() {
  if (!rec.preview) return;
  rec.preview.stopLoop?.();
  rec.preview.streams.forEach((s) => s?.getTracks().forEach((t) => t.stop()));
  rec.preview.ctx?.close().catch(() => {});
  rec.preview = null;
}

async function startPreview() {
  stopPreview();
  const micId = resolvedMicId();
  const othersId = resolvedOthersId();
  try {
    const mic = await getStream(micId, true);
    const others = othersId ? await getStream(othersId, false) : null;
    const ctx = new AudioContext();
    rec.preview = { streams: [mic, others], ctx };
    rec.preview.stopLoop = levelLoop(ctx, [mic, others], ['#lvl-me', '#lvl-others']);
  } catch (err) {
    $('#rec-error').innerHTML = `<div class="form-error">${esc(micError(err))}</div>`;
  }
}

function micError(err) {
  if (err.name === 'NotAllowedError') return 'Microphone access was blocked. In your browser\'s address bar, allow microphone access for localhost, then reload the page.';
  if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'That audio device was not found. Pick another one.';
  return `Couldn't use the microphone: ${err.message}`;
}

async function renderRecord() {
  const view = $('#view');
  if (!supportsRecording()) {
    view.innerHTML = '<div class="card empty"><h3>Recording isn\'t supported in this browser</h3><p>Open this page in Google Chrome.</p></div>';
    return;
  }
  if (rec.session) return renderRecordingInProgress();

  try { await loadDevices(); } catch { rec.devices = []; }
  const media = state.status?.media || {};
  const bh = blackhole();
  const deviceOptions = (selected, includeNone) => [
    includeNone ? `<option value="" ${selected === '' ? 'selected' : ''}>Don't record meeting audio (my microphone only)</option>` : '',
    ...rec.devices.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === selected ? 'selected' : ''}>${esc(d.label || `Microphone ${i + 1}`)}</option>`),
  ].join('');

  view.innerHTML = `
    <div class="page-head"><div><h1>Record a meeting</h1><p>Records your voice and the Teams audio on your Mac, then transcribes it for free.</p></div></div>
    <div class="record-grid">
      <div class="stack">
        <section class="card card-pad">
          <h3 class="card-title"><span class="icon icon-accent">${ICONS.mic}</span>Audio sources</h3>
          ${!hasLabels() ? `
            <p class="muted-note" style="margin-bottom:12px">First, let the app use your microphone. Your browser will ask for permission.</p>
            <button class="btn btn-primary" id="allow-mic">${ICONS.mic} Allow microphone</button>` : `
          <div class="source">
            <div class="source-head"><label class="label" for="mic-select">Your microphone</label><span class="muted-note">Labelled as you</span></div>
            <select class="input select" id="mic-select">${deviceOptions(resolvedMicId(), false)}</select>
            <div class="level"><i id="lvl-me"></i></div>
          </div>
          <div class="source">
            <div class="source-head"><label class="label" for="others-select">Meeting audio (other people)</label>${bh ? '<span class="badge badge-green">BlackHole found</span>' : '<span class="badge badge-amber">BlackHole not found</span>'}</div>
            <select class="input select" id="others-select">${deviceOptions(resolvedOthersId(), true)}</select>
            <div class="level"><i id="lvl-others"></i></div>
            <p class="hint">${bh ? 'Set Teams → Settings → Devices → Speaker to your "Multi-Output Device" so this bar moves when others talk.' : 'To capture other people, install BlackHole (see Settings → "Hearing other people"). Without it, only your microphone is recorded.'}</p>
          </div>`}
          <div id="rec-error"></div>
        </section>

        <section class="card card-pad">
          <h3 class="card-title"><span class="icon icon-blue">${ICONS.doc}</span>Meeting details <span class="muted-note" style="font-weight:400">(you can fill these in while recording)</span></h3>
          <div class="stack" style="gap:12px">
            <div><label class="label" for="r-title">Title</label><input class="input" id="r-title" placeholder="e.g. Weekly sales sync" maxlength="140" /></div>
            <div class="row-2">
              <div><label class="label" for="r-account">Company / account</label><input class="input" id="r-account" placeholder="Optional" maxlength="120" /></div>
              <div><label class="label" for="r-attendees">Attendees</label><input class="input" id="r-attendees" placeholder="Names, comma separated" /></div>
            </div>
          </div>
        </section>
      </div>

      <div class="stack">
        <section class="card rec-stage">
          <button class="rec-button" id="rec-start" title="Start recording" ${hasLabels() ? '' : 'disabled'}>${ICONS.mic}</button>
          <div class="rec-time">0:00</div>
          <p class="muted-note">Press to start recording</p>
        </section>
        ${hasLabels() ? autoCardHtml() : ''}
        <section class="card card-pad">
          <h3 class="card-title"><span class="icon icon-amber">${ICONS.bulb}</span>Before you start</h3>
          <ul class="checklist">
            <li><span class="tick ${media.ready ? 'ok' : 'no'}">${media.ready ? '✓' : '!'}</span><span>${media.ready ? 'Transcription is set up.' : 'Transcription isn\'t set up yet. You can still record; it will be transcribed after setup. <a href="#/settings" style="color:var(--accent)">Set up</a>'}</span></li>
            <li><span class="tick ok">✓</span><span>No headphones is fine: if your mic picks up the others through the speakers, those echoes are removed automatically. Headphones give the cleanest result.</span></li>
            <li><span class="tick ok">✓</span><span>Tell participants you're recording for meeting notes.</span></li>
            <li><span class="tick ok">✓</span><span>Keep this tab open until you press Stop.${isSafari() ? ' Recording both sources works best in <b>Google Chrome</b>.' : ''}</span></li>
          </ul>
        </section>
      </div>
    </div>`;

  $('#allow-mic')?.addEventListener('click', async () => {
    try {
      const s = await getStream('', true);
      s.getTracks().forEach((t) => t.stop());
      await loadDevices();
      renderRecord();
    } catch (err) {
      $('#rec-error').innerHTML = `<div class="form-error">${esc(micError(err))}</div>`;
    }
  });
  const saveLabel = (key, id) => localStorage.setItem(key, rec.devices.find((d) => d.deviceId === id)?.label || '');
  $('#mic-select')?.addEventListener('change', (e) => { rec.micId = e.target.value; localStorage.setItem('rec.mic', rec.micId); saveLabel('rec.micLabel', rec.micId); startPreview(); });
  $('#others-select')?.addEventListener('change', (e) => {
    rec.othersId = e.target.value;
    localStorage.setItem('rec.others', rec.othersId);
    saveLabel('rec.othersLabel', rec.othersId);
    if (rec.auto.enabled) startAutoMonitor();
    renderRecord();
  });
  $('#rec-start').addEventListener('click', () => startRecordingSession());
  wireAutoCard();

  if (hasLabels()) startPreview();
}

function uploadChunk(meetingId, track, blob) {
  const attempt = async (n) => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}/chunk?track=${track}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    } catch (err) {
      if (n < 4) {
        await new Promise((r) => setTimeout(r, 1000 * (n + 1)));
        return attempt(n + 1);
      }
      throw err;
    }
  };
  return attempt(0);
}

// opts.auto = started automatically because Teams audio was detected
async function startRecordingSession(opts = {}) {
  const auto = !!opts.auto;
  if (rec.session) return;
  const btn = $('#rec-start');
  if (btn) btn.disabled = true;
  if ($('#rec-error')) $('#rec-error').innerHTML = '';
  const showError = (msg) => {
    const box = $('#rec-error');
    if (box && !auto) box.innerHTML = `<div class="form-error">${esc(msg)}</div>`;
    else toast(msg, 'error');
    if (btn) btn.disabled = false;
  };
  stopPreview();
  if (!rec.devices.length) { try { await loadDevices(); } catch { /* handled below */ } }

  const micId = resolvedMicId();
  const othersId = resolvedOthersId();
  let mic;
  let others = null;
  try {
    mic = await getStream(micId, true);
    if (othersId) others = await getStream(othersId, false);
  } catch (err) {
    mic?.getTracks().forEach((t) => t.stop());
    return showError(micError(err));
  }
  // Some browsers silently stop the first device when a second one is opened.
  if (others && mic.getAudioTracks()[0].readyState === 'ended') {
    others.getTracks().forEach((t) => t.stop());
    return showError('This browser can only record one audio source at a time. Please use Google Chrome to record both your voice and the meeting.');
  }

  const field = (k) => $(`#r-${k}`)?.value || '';
  const now = new Date();
  const fields = {
    title: field('title') || (auto ? `Teams call ${now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${fmtTimeOfDay(now.toISOString())}` : ''),
    account: field('account'),
    attendees: field('attendees'),
  };

  const { mime, ext } = pickMime();
  let meeting;
  try {
    meeting = await api('/recordings', { method: 'POST', body: { ...fields, tracks: others ? ['me', 'others'] : ['me'], ext } });
  } catch (err) {
    [mic, others].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
    return showError(err.message);
  }

  const session = { recorders: [], streams: [mic, others], chains: {}, startedAt: Date.now(), failed: false, auto, fields };
  const tracks = [['me', mic], ['others', others]].filter(([, s]) => s);
  for (const [track, stream] of tracks) {
    const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64000 });
    session.chains[track] = Promise.resolve();
    r.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      session.chains[track] = session.chains[track]
        .then(() => uploadChunk(meeting.id, track, e.data))
        .catch((err) => {
          if (!session.failed) toast(`Part of the recording couldn't be saved: ${err.message}`, 'error');
          session.failed = true;
        });
    };
    session.recorders.push(r);
  }
  session.recorders.forEach((r) => r.start(5000)); // save to disk every 5 seconds
  try { session.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }

  rec.meetingId = meeting.id;
  rec.session = session;
  window.onbeforeunload = (e) => { e.preventDefault(); e.returnValue = ''; };
  session.timer = setInterval(updateRecTimer, 500);
  updateIndicator();
  if (location.hash === '#/record') renderRecordingInProgress();
  if (auto) {
    toast('Teams call detected. Recording started');
    notify('Recording started', 'Teams call detected. Meeting Assistant is recording.');
  }
}

function recElapsed() {
  return rec.session ? (Date.now() - rec.session.startedAt) / 1000 : 0;
}

function updateRecTimer() {
  const t = fmtClock(recElapsed());
  const small = $('#rec-indicator-time');
  if (small) small.textContent = t;
  const big = $('#rec-live-time');
  if (big) big.textContent = t;
}

function renderRecordingInProgress() {
  const s = rec.session;
  const two = !!s.streams[1];
  const f = s.fields;
  $('#view').innerHTML = `
    <div class="page-head"><div><h1>Recording</h1><p>Everything is saved to your Mac every few seconds.</p></div></div>
    <div class="record-grid">
      <div class="stack">
        <section class="card card-pad">
          <h3 class="card-title"><span class="icon icon-accent">${ICONS.mic}</span>Levels</h3>
          <div class="source"><div class="source-head"><span class="label">Your microphone</span></div><div class="level"><i id="lvl-me"></i></div></div>
          ${two ? '<div class="source"><div class="source-head"><span class="label">Meeting audio</span></div><div class="level"><i id="lvl-others"></i></div></div>' : '<p class="hint">Only your microphone is being recorded.</p>'}
        </section>
        <section class="card card-pad">
          <h3 class="card-title"><span class="icon icon-blue">${ICONS.doc}</span>Meeting details</h3>
          <div class="stack" style="gap:12px">
            <div><label class="label" for="r-title">Title</label><input class="input" id="r-title" maxlength="140" value="${esc(f.title ?? '')}" placeholder="e.g. Weekly sales sync" /></div>
            <div class="row-2">
              <div><label class="label" for="r-account">Company / account</label><input class="input" id="r-account" maxlength="120" value="${esc(f.account ?? '')}" placeholder="Optional" /></div>
              <div><label class="label" for="r-attendees">Attendees</label><input class="input" id="r-attendees" value="${esc(f.attendees ?? '')}" placeholder="Names, comma separated" /></div>
            </div>
          </div>
        </section>
      </div>
      <div class="stack">
        <section class="card rec-stage">
          <button class="rec-button stop" id="rec-stop" title="Stop and transcribe"><span></span></button>
          <div class="rec-time" id="rec-live-time">${fmtClock(recElapsed())}</div>
          <p class="muted-note"><span class="rec-dot" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>${s.auto ? 'Started automatically. Stops by itself after the call ends, or press to stop now' : 'Recording. Press to stop and transcribe'}</p>
          <div class="rec-actions"><button class="btn btn-sm btn-ghost btn-danger" id="rec-discard">${ICONS.trash} Discard recording</button></div>
        </section>
      </div>
    </div>`;

  ['title', 'account', 'attendees'].forEach((k) => $(`#r-${k}`).addEventListener('input', (e) => { s.fields[k] = e.target.value; }));
  if (s.stopLoop) s.stopLoop();
  if (!s.ctx) s.ctx = new AudioContext();
  s.stopLoop = levelLoop(s.ctx, s.streams, ['#lvl-me', '#lvl-others']);
  $('#rec-stop').addEventListener('click', () => stopRecordingSession());
  $('#rec-discard').addEventListener('click', async () => {
    if (!confirm('Discard this recording? It will be deleted from your Mac.')) return;
    const id = rec.meetingId;
    await endSession();
    rec.auto.waitForSilence = rec.auto.enabled; // don't restart straight away mid-call
    await api(`/meetings/${id}`, { method: 'DELETE' }).catch(() => {});
    toast('Recording discarded');
    renderRecord();
  });
}

async function endSession() {
  const s = rec.session;
  if (!s) return;
  await Promise.all(s.recorders.map((r) => new Promise((resolve) => {
    if (r.state === 'inactive') return resolve();
    r.addEventListener('stop', resolve, { once: true });
    r.stop();
  })));
  await Promise.all(Object.values(s.chains)); // wait until every piece is saved
  clearInterval(s.timer);
  s.stopLoop?.();
  s.streams.forEach((st) => st?.getTracks().forEach((t) => t.stop()));
  s.ctx?.close().catch(() => {});
  s.wakeLock?.release?.().catch(() => {});
  rec.session = null;
  rec.meetingId = null;
  window.onbeforeunload = null;
  updateIndicator();
}

// opts.auto: stopped automatically after silence. opts.discard: too short to be a call.
async function stopRecordingSession(opts = {}) {
  if (!rec.session || rec.stopping) return;
  rec.stopping = true;
  const btn = $('#rec-stop');
  if (btn) btn.disabled = true;
  const note = $('.rec-stage .muted-note');
  if (note) note.textContent = 'Saving the last few seconds…';
  const id = rec.meetingId;
  const fields = { ...rec.session.fields };
  await endSession();
  rec.stopping = false;
  // After a manual stop, wait for the call to go quiet before auto-recording again.
  if (!opts.auto) rec.auto.waitForSilence = rec.auto.enabled;
  setAutoStatus(rec.auto.mon ? (rec.auto.waitForSilence ? 'waiting' : 'listening') : rec.auto.status);

  if (opts.discard) {
    await api(`/meetings/${id}`, { method: 'DELETE' }).catch(() => {});
    toast('Short sound ignored (not long enough to be a call)');
    if (location.hash === '#/record') renderRecord();
    return;
  }
  try {
    await api(`/meetings/${id}/finish`, { method: 'POST', body: fields });
    toast('Recording saved. Transcribing now');
  } catch (err) {
    toast(err.message, 'error');
  }
  if (opts.auto) {
    notify('Call recording saved', 'Transcribing now. Open Meeting Assistant to create the MoM.');
    if (location.hash === '#/record') renderRecord();
    else if (location.hash === '#/' || location.hash === '') renderMeetings();
  } else {
    location.hash = `#/meeting/${id}`;
  }
}

// ---------- Auto-record ----------
// Listens to the Teams audio (BlackHole). When people start talking it starts
// recording; after a stretch of silence it stops and transcribes. Detection runs in
// an AudioWorklet so it keeps working while this tab is in the background.
const num = (key, fallback) => Number(localStorage.getItem(key)) || fallback;
const AUTO = {
  threshold: 0.004,                                  // BlackHole is digitally silent when nothing plays
  windowMs: 4000,                                    // look at the last 4 seconds…
  startAfterMs: num('rec.autoStartMs', 2000),        // …and start once 2 s of it had sound
  stopAfterSilenceMs: num('rec.autoSilenceMs', 15 * 60000), // stop after 15 minutes of silence (changeable on the Record page)
  minVoicedMs: num('rec.autoMinVoicedMs', 20000),    // shorter than 20 s of sound = ringtone/notification, discard
  rearmAfterSilenceMs: num('rec.autoRearmMs', 60000),
};
rec.auto = { enabled: localStorage.getItem('rec.auto') === '1', mon: null, history: [], lastLoud: 0, voiced: 0, waitForSilence: false, starting: false, status: 'off', message: '' };

const LEVEL_WORKLET = `
class LevelMeter extends AudioWorkletProcessor {
  constructor() { super(); this.sum = 0; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this.sum += ch[i] * ch[i];
      this.n += ch.length;
      if (this.n >= sampleRate / 10) {
        this.port.postMessage({ rms: Math.sqrt(this.sum / this.n), ms: (this.n / sampleRate) * 1000 });
        this.sum = 0; this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('level-meter', LevelMeter);`;

function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: '/favicon.svg' });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch { /* notifications are optional */ }
}

const AUTO_TEXT = {
  off: 'Off.',
  listening: 'On: listening for Teams audio. Recording starts by itself when a call begins.',
  waiting: 'On: waiting for the current call audio to stop before listening again.',
  'needs-click': 'Paused: click anywhere on this page to switch it on (Chrome needs one click after opening).',
  'no-blackhole': 'Needs BlackHole as the "Meeting audio" source to detect calls.',
  error: 'Could not start.',
};

function setAutoStatus(status, message = '') {
  rec.auto.status = status;
  rec.auto.message = message;
  const el = $('#auto-status');
  if (el) el.textContent = message || AUTO_TEXT[status] || '';
  updateIndicator();
}

function updateIndicator() {
  const el = $('#rec-indicator');
  if (!el) return;
  if (rec.session) {
    el.className = 'rec-indicator';
    el.innerHTML = `<span class="rec-dot"></span><span>Recording <strong id="rec-indicator-time">${fmtClock(recElapsed())}</strong></span>`;
    el.hidden = false;
  } else if (rec.auto.enabled && ['listening', 'waiting'].includes(rec.auto.status)) {
    el.className = 'rec-indicator listening';
    el.innerHTML = '<span class="listen-dot"></span><span>Auto-record on</span>';
    el.hidden = false;
  } else if (rec.auto.enabled && rec.auto.status === 'needs-click') {
    el.className = 'rec-indicator paused';
    el.innerHTML = '<span class="listen-dot"></span><span>Auto-record paused. Click to resume</span>';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function resumeAutoMonitor() {
  try { await rec.auto.mon?.ctx.resume(); } catch { /* try again on next click */ }
  if (rec.auto.mon?.ctx.state === 'running') setAutoStatus(rec.auto.waitForSilence ? 'waiting' : 'listening');
  else document.addEventListener('pointerdown', resumeAutoMonitor, { once: true });
}

async function startAutoMonitor() {
  stopAutoMonitor();
  if (!rec.auto.enabled || !supportsRecording()) return setAutoStatus('off');
  try { await loadDevices(); } catch { /* no permission yet */ }
  const id = resolvedOthersId();
  if (!id) return setAutoStatus('no-blackhole');
  try {
    const stream = await getStream(id, false);
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([LEVEL_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'level-meter');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(mute).connect(ctx.destination);
    node.port.onmessage = (e) => onAutoLevel(e.data);
    rec.auto.mon = { stream, ctx, node };
    rec.auto.history = [];
    rec.auto.lastLoud = 0;
    if (ctx.state === 'running') setAutoStatus('listening');
    else {
      setAutoStatus('needs-click');
      document.addEventListener('pointerdown', resumeAutoMonitor, { once: true });
    }
  } catch (err) {
    setAutoStatus('error', `Could not start: ${micError(err)}`);
  }
}

function stopAutoMonitor() {
  const m = rec.auto.mon;
  if (!m) return;
  m.node.port.onmessage = null;
  m.stream.getTracks().forEach((t) => t.stop());
  m.ctx.close().catch(() => {});
  rec.auto.mon = null;
}

function onAutoLevel({ rms, ms }) {
  const a = rec.auto;
  const now = Date.now();
  const loud = rms > AUTO.threshold;
  if (loud) a.lastLoud = now;
  a.history.push({ t: now, ms, loud });
  while (a.history.length && a.history[0].t < now - AUTO.windowMs) a.history.shift();

  if (a.waitForSilence) {
    if (now - a.lastLoud > AUTO.rearmAfterSilenceMs) {
      a.waitForSilence = false;
      if (!rec.session) setAutoStatus('listening');
    }
    return;
  }

  const s = rec.session;
  if (!s) {
    const loudMs = a.history.reduce((sum, h) => sum + (h.loud ? h.ms : 0), 0);
    if (!a.starting && loudMs >= AUTO.startAfterMs) {
      a.starting = true;
      a.voiced = loudMs;
      startRecordingSession({ auto: true }).finally(() => { a.starting = false; });
    }
    return;
  }
  if (!s.auto || rec.stopping) return;
  if (loud) a.voiced += ms;
  if (now - a.lastLoud > AUTO.stopAfterSilenceMs) {
    stopRecordingSession({ auto: true, discard: a.voiced < AUTO.minVoicedMs });
  }
}

function autoCardHtml() {
  const bh = !!resolvedOthersId();
  return `
    <section class="card card-pad">
      <h3 class="card-title"><span class="icon icon-green">${ICONS.wave}</span>Auto-record Teams calls
        <label class="switch" title="${bh ? '' : 'Choose BlackHole as Meeting audio first'}"><input type="checkbox" id="auto-toggle" ${rec.auto.enabled ? 'checked' : ''} ${bh || rec.auto.enabled ? '' : 'disabled'} /><span></span></label>
      </h3>
      <p class="muted-note" id="auto-status">${esc(rec.auto.message || AUTO_TEXT[rec.auto.status] || '')}</p>
      <div class="auto-row"><label class="label" for="auto-silence">Stop after silence of</label>
        <select class="input select" id="auto-silence">${[3, 5, 10, 15, 20, 30].map((m) => `<option value="${m}" ${AUTO.stopAfterSilenceMs === m * 60000 ? 'selected' : ''}>${m} minutes</option>`).join('')}</select></div>
      <p class="hint">Starts recording when Teams audio is heard and stops after this much silence. Keep this Chrome tab open (right-click the tab → <b>Pin</b>).</p>
    </section>`;
}

function wireAutoCard() {
  $('#auto-silence')?.addEventListener('change', (e) => {
    AUTO.stopAfterSilenceMs = Number(e.target.value) * 60000;
    localStorage.setItem('rec.autoSilenceMs', String(AUTO.stopAfterSilenceMs));
    toast(`Auto-record will stop after ${e.target.value} minutes of silence`);
  });
  $('#auto-toggle')?.addEventListener('change', async (e) => {
    rec.auto.enabled = e.target.checked;
    localStorage.setItem('rec.auto', rec.auto.enabled ? '1' : '0');
    if (rec.auto.enabled) {
      try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* optional */ }
      await startAutoMonitor();
      toast('Auto-record is on');
    } else {
      stopAutoMonitor();
      setAutoStatus('off');
      if (rec.session) rec.session.auto = false; // keep recording; you'll stop it yourself
      toast('Auto-record is off');
    }
  });
}

// ---------- Settings page ----------
async function renderSettings() {
  try { state.status = await api('/status'); renderAiPill(); } catch { /* keep old */ }
  const s = state.status || {};
  const m = s.media || {};
  const tick = (ok) => `<span class="tick ${ok ? 'ok' : 'no'}">${ok ? '✓' : '!'}</span>`;
  const cmd = (c) => `<div class="cmd"><code>${esc(c)}</code><button class="btn btn-sm" data-copy="${esc(c)}">${ICONS.copy}</button></div>`;
  const view = $('#view');
  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Setup status, where your files live, and what's next.</p></div></div>
    <div class="settings-grid">
      <section class="card card-pad">
        <h3 class="card-title"><span class="icon ${m.ready ? 'icon-green' : 'icon-amber'}">${ICONS.wave}</span>Recording &amp; transcription</h3>
        <ul class="checklist">
          <li>${tick(m.ffmpeg)}<span>ffmpeg (audio converter) ${m.ffmpeg ? 'installed' : 'not installed'}</span></li>
          <li>${tick(m.whisper)}<span>Whisper (speech-to-text) ${m.whisper ? 'installed' : 'not installed'}</span></li>
          <li>${tick(!!m.model)}<span>Whisper model ${m.model ? `downloaded (${esc(m.model)})` : 'not downloaded'}</span></li>
        </ul>
        ${m.ready ? '<p class="muted-note" style="margin-top:14px">All set. Recordings are transcribed on your Mac, for free.</p>' : `
        <p class="muted-note" style="margin-top:14px">In Terminal, inside the project folder (stop the app first with Ctrl+C):</p>
        ${!m.ffmpeg || !m.whisper ? cmd('brew install ffmpeg whisper-cpp') : ''}
        ${cmd('npm run setup')}
        <p class="hint">No Homebrew? Follow step 3 in README.md. Then run <code>npm start</code> again.</p>`}
      </section>

      <section class="card card-pad">
        <h3 class="card-title"><span class="icon icon-blue">${ICONS.users}</span>Hearing other people (BlackHole)</h3>
        <p class="muted-note">Teams' sound normally goes only to your headphones. BlackHole is a free tool that lets the app record it too.</p>
        <ol class="steps-plain">
          <li>Install it: ${cmd('brew install --cask blackhole-2ch')} then restart your Mac.</li>
          <li>Open <b>Audio MIDI Setup</b> (⌘ Space, type it). Click <b>+</b> → <b>Create Multi-Output Device</b>. Tick your <b>headphones</b> and <b>BlackHole 2ch</b>, and tick "Drift Correction" for BlackHole.</li>
          <li>In <b>Teams</b> → Settings → Devices → <b>Speaker</b>: choose <b>Multi-Output Device</b>. (Keep your normal microphone.)</li>
          <li>On the Record page, "Meeting audio" should now show <b>BlackHole 2ch</b>.</li>
        </ol>
      </section>

      <section class="card card-pad">
        <h3 class="card-title"><span class="icon icon-green">${ICONS.sparkles}</span>AI for MoM &amp; insights</h3>
        <p><span class="badge badge-green"><span class="dot"></span>Free copy-paste mode: always on</span></p>
        <p class="muted-note" style="margin-top:10px">Click <b>Create MoM</b> on a meeting, copy the prompt into Claude or Gemini, and paste the reply back. Uses your existing subscription.</p>
        <p style="margin-top:14px">${s.aiConfigured ? `<span class="badge badge-green">Claude API connected</span> <span class="muted-note">One-click mode with <code>${esc(s.model)}</code>.</span>` : '<span class="badge badge-muted">Optional: Claude API not connected</span>'}</p>
        ${s.aiConfigured ? '' : '<p class="hint">For one-click MoM later, add API credits and a key to <code>.env</code> (see README, step 6).</p>'}
      </section>

      <section class="card card-pad">
        <h3 class="card-title"><span class="icon icon-accent">${ICONS.file}</span>Your data</h3>
        <p class="muted-note">Meetings, transcripts and recordings are saved as files on your Mac, in:</p>
        <p style="margin-top:8px"><code>${esc(s.dataDir || 'data/')}</code></p>
        <p class="muted-note" style="margin-top:12px">Recordings never leave your Mac. Only the transcript text goes to Claude or Gemini, and only when you paste it in yourself (or use the API).</p>
        ${s.myName ? '' : '<p class="hint" style="margin-top:10px">Tip: add <code>MY_NAME=Your Name</code> to the <code>.env</code> file so transcripts and MoMs use your name instead of "You".</p>'}
      </section>

      <section class="card card-pad wide">
        <h3 class="card-title"><span class="icon icon-accent">${ICONS.trend}</span>Roadmap</h3>
        <div class="roadmap">
          <div class="phase"><span class="badge badge-green">Done</span><h4>Transcripts &amp; insights</h4><p>Import Teams transcripts, AI insights, browse and export meetings.</p></div>
          <div class="phase"><span class="badge badge-green">Now</span><h4>Record, transcribe, MoM</h4><p>Record Teams calls or upload recordings, free local transcription, one-click minutes of meeting.</p></div>
          <div class="phase"><span class="badge badge-muted">Ideas</span><h4>Next</h4><p>Auto-start recording when a Teams call begins, edit the MoM before sending, search across all meetings.</p></div>
        </div>
      </section>
    </div>`;

  view.onclick = (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copyText(b.dataset.copy, 'Command copied. Paste it into Terminal');
  };
}

// ---------- Global wiring ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="open-import"]')) openImport();
});
window.addEventListener('hashchange', route);

(async function start() {
  try {
    state.status = await api('/status');
  } catch {
    state.status = { aiConfigured: false, media: {} };
  }
  renderAiPill();
  route();
  if (rec.auto.enabled) startAutoMonitor();
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if (rec.auto.enabled && !rec.auto.mon) startAutoMonitor();
  });
})();
