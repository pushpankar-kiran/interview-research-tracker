"use strict";

const $ = (sel) => document.querySelector(sel);
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (r.status === 429) {
    const retry = r.headers.get("Retry-After") || "a few";
    flash(`Rate limit hit — slow down (retry in ${retry}s).`);
    return { error: "rate_limited", retry_after: retry };
  }
  try { return await r.json(); } catch { return { error: "bad_response" }; }
};

let _flashTimer = null;
function flash(msg) {
  const bar = $("#errors-bar");
  if (!bar) return;
  bar.hidden = false;
  bar.textContent = `⚠ ${msg}`;
  clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => { bar.hidden = true; }, 4000);
}

let state = {
  slug: null, tab: "brief", session: null, poll: null, bootTimer: null,
  view: "company", voiceOn: false, answerStart: null,
};

// ==========================================================================
// Sidebar
// ==========================================================================
async function refreshSidebar() {
  const [{ companies }, { jobs }] = await Promise.all([
    api("/api/companies"), api("/api/jobs"),
  ]);
  // slugs that actually have a task queued right now — the badge derives from
  // this, not from a possibly-stale stored status.
  const pending = new Set((jobs || []).map((j) => j.slug));

  const ul = $("#company-list");
  ul.innerHTML = companies && companies.length ? "" : '<li class="muted">None yet.</li>';
  for (const c of (companies || [])) {
    const li = document.createElement("li");
    if (c.slug === state.slug && state.view === "company") li.classList.add("active");
    let badge, cls;
    if (c.has_brief) { badge = "ready"; cls = "ready"; }
    else if (pending.has(c.slug)) { badge = "researching…"; cls = "queued_discovery"; }
    else { badge = "not researched"; cls = "idle-badge"; }
    const sub = [c.role, c.region ? "📍 " + c.region : null].filter(Boolean).join(" · ");
    li.innerHTML =
      `<span><span class="co-name">${esc(c.name)}</span>` +
      (sub ? `<br><span class="co-role">${esc(sub)}</span>` : "") +
      `</span><span class="status ${cls}">${badge}</span>`;
    li.onclick = () => openCompany(c.slug);
    ul.appendChild(li);
  }

  $("#queue-count").textContent = (jobs || []).length;
  const jl = $("#job-list");
  jl.innerHTML = (jobs || []).length ? "" : '<li class="muted">Empty.</li>';
  for (const j of (jobs || [])) {
    const li = document.createElement("li");
    li.textContent = `${j.type} · ${j.slug}` + (j.session_id ? ` · ${j.session_id}` : "");
    jl.appendChild(li);
  }
  renderStatus(jobs || []);
  await checkProgress([...pending]);

  const { errors } = await api("/api/errors");
  const bar = $("#errors-bar");
  if (errors && errors.length && bar.hidden) {
    bar.hidden = false;
    bar.textContent = `⚠ ${errors[0].context}: ${errors[0].message}`;
  }

  const usage = await api("/api/usage");
  if (usage && typeof usage.total === "number") {
    window._usage = usage;
    $("#usage-pill").textContent = `🔢 ~${fmtNum(usage.total)} tok`;
  }
}

function fmtNum(n) { return Number(n || 0).toLocaleString(); }

const USAGE_LABELS = {
  research: "Company research (briefs)",
  questions: "Reported & predicted questions",
  resume_gap: "Resume gap analysis",
  interviews: "Mock interviews (Q&A + feedback)",
  stories: "STAR story bank",
};

function showUsage() {
  const u = window._usage || { categories: {}, total: 0, note: "" };
  let ov = document.getElementById("usage-overlay");
  if (!ov) { ov = document.createElement("div"); ov.id = "usage-overlay"; document.body.appendChild(ov); }
  const rows = Object.entries(u.categories || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${esc(USAGE_LABELS[k] || k)}</td><td class="num">~${fmtNum(v)}</td></tr>`)
    .join("");
  ov.innerHTML = `<div class="usage-card">
    <div class="usage-head"><h2>🔢 Estimated token usage</h2>
      <button class="secondary tiny" id="usage-close">Close</button></div>
    <div class="usage-total">~${fmtNum(u.total)} <span>tokens of generated content</span></div>
    <table class="usage-table"><tbody>${rows || '<tr><td class="muted">Nothing generated yet.</td><td></td></tr>'}</tbody></table>
    <p class="usage-note">⚠ ${esc(u.note || "")}</p>
  </div>`;
  ov.hidden = false;
  $("#usage-close").onclick = () => { ov.hidden = true; };
  ov.onclick = (e) => { if (e.target === ov) ov.hidden = true; };
}
$("#usage-pill").onclick = showUsage;

// ==========================================================================
// Stage-by-stage progress + intimations
// ==========================================================================
let _seenStages = {};        // slug -> Set of stage names already announced
let _progressInit = {};      // slug -> true once we've baselined existing stages

function intimate(msg, opts) {
  toast(msg, opts && opts.kind);
  if (window.Notification && Notification.permission === "granted") {
    try { new Notification("Interview Research Tracker", { body: msg, silent: true }); } catch (_) {}
  }
}

function toast(msg, kind) {
  const box = $("#toasts");
  if (!box) return;
  const t = document.createElement("div");
  t.className = "toast" + (kind ? " " + kind : "");
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 6000);
}

async function checkProgress(slugs) {
  for (const slug of slugs) {
    const p = await api(`/api/companies/${slug}/progress`);
    if (!p || !p.stages) continue;
    const seen = _seenStages[slug] || new Set();
    const first = !_progressInit[slug];
    for (const s of p.stages) {
      if (s.status === "done" && !seen.has(s.name)) {
        seen.add(s.name);
        // Don't spam toasts for stages already finished before this page load.
        if (!first) intimate(`✓ ${prettySlug(slug)}: ${s.name}${s.note ? " — " + s.note : ""}`);
      }
    }
    _seenStages[slug] = seen;
    _progressInit[slug] = true;
    if (p.done && !seen.has("__done__")) {
      seen.add("__done__");
      if (!first) intimate(`✅ ${prettySlug(slug)}: research complete`, { kind: "done" });
    }
    // live checklist if this company is open
    if (state.slug === slug && state.view === "company") renderProgressPanel(p);
  }
}

function renderProgressPanel(p) {
  const host = document.getElementById("progress-panel");
  if (!host) return;
  if (!p || !p.stages || p.done) { host.innerHTML = ""; return; }
  const rows = p.stages.map((s) => {
    const icon = s.status === "done" ? "✓" : s.status === "active" ? "⏳" : "○";
    return `<li class="st-${s.status}">${icon} ${esc(s.name)}</li>`;
  }).join("");
  host.innerHTML = `<div class="progress-card"><div class="progress-title">Research in progress</div>
    <ul class="progress-list">${rows}</ul></div>`;
}

function prettySlug(s) { return String(s).replace(/-/g, " "); }

// desktop-notification permission
function refreshNotifyBtn() {
  const b = $("#notify-btn");
  if (!b || !window.Notification) { if (b) b.style.display = "none"; return; }
  b.textContent = Notification.permission === "granted" ? "🔔 on" : "🔔";
}
$("#notify-btn").onclick = async () => {
  if (!window.Notification) return;
  if (Notification.permission === "granted") { toast("Desktop notifications already on."); return; }
  const res = await Notification.requestPermission();
  refreshNotifyBtn();
  if (res === "granted") intimate("Desktop notifications enabled — you'll be told as each stage completes.");
  else toast("Notifications blocked — you'll still see on-screen toasts.");
};
refreshNotifyBtn();
function shortStatus(s) {
  return { queued_discovery: "researching…", queued_update: "updating…" }[s] || s || "—";
}

// Plain-language description of what each queued background task is doing.
function friendlyJob(j) {
  const s = j.slug || "";
  const map = {
    discover: `Researching “${s}” — finding official pages, interview format, and recent news`,
    update: `Checking “${s}” for anything new since last time`,
    questions: `Finding reported interview questions for “${s}” from public sources`,
    predict: `Generating predicted questions for “${s}”, grounded in its recent news`,
    resume_gap: `Analysing your resume against the role for “${s}”`,
    interview_turn: `Interviewer is preparing the next question`,
    feedback: `Scoring your interview and writing feedback`,
  };
  return map[j.type] || `${j.type} · ${s}`;
}

function renderStatus(jobs) {
  const bar = $("#status-bar");
  if (!bar) return;
  if (!jobs.length) {
    bar.className = "idle";
    bar.innerHTML = `<span class="dot"></span>
      <span><b>System idle.</b> Nothing is running in the background — the app only
      works while you act. When you add a company or answer a question, a task
      appears here.</span>`;
    return;
  }
  bar.className = "working";
  const shown = jobs.slice(0, 4).map((j) => `<li>${esc(friendlyJob(j))}</li>`).join("");
  const more = jobs.length > 4 ? `<li>…and ${jobs.length - 4} more</li>` : "";
  bar.innerHTML = `
    <div class="status-head"><span class="dot pulse"></span>
      <b>${jobs.length} background task${jobs.length > 1 ? "s" : ""} in progress</b>
      <span class="status-hint">— being handled in your Claude Code session</span></div>
    <ul class="status-list">${shown}${more}</ul>`;
}

$("#add-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("#add-name").value.trim();
  const role = $("#add-role").value.trim();
  const region = $("#add-region").value.trim();
  if (!name) return;
  await api("/api/companies", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name_or_url: name, role, region }),
  });
  $("#add-name").value = ""; $("#add-role").value = ""; $("#add-region").value = "";
  await refreshSidebar();
};

// ==========================================================================
// Company detail
// ==========================================================================
async function openCompany(slug) {
  stopPoll();
  state.slug = slug; state.tab = "brief"; state.session = null; state.view = "company";
  await refreshSidebar();
  await renderDetail();
}

async function renderDetail() {
  const data = await api(`/api/companies/${state.slug}`);
  $("#empty-state").hidden = true;
  const el = $("#company-detail");
  el.hidden = false;
  const meta = data.meta || {};
  const brief = data.brief;

  const tabs = [
    ["brief", "Company Brief"],
    ["questions", "Questions"],
    ["interview", "Mock Interview"],
    ["stories", "Story Bank"],
    ["history", `History (${data.sessions.length})`],
    ["prep", "Prep Pack"],
  ];
  el.innerHTML = `
    <div class="detail-head">
      <h1>${esc(meta.name || state.slug)}</h1>
      ${meta.role ? `<span class="pill">${esc(meta.role)}</span>` : ""}
      ${meta.region ? `<span class="pill region-pill">📍 ${esc(meta.region)}</span>` : ""}
      <div class="detail-actions">
        <button class="secondary" id="btn-update">Run Update</button>
      </div>
    </div>
    <p class="subline">${brief
      ? `Researched ${fmt(brief.discovered_at)} · format: <b>${esc(brief.interview_format || "unknown")}</b>`
      : `<span class="waiting">Research queued — process it in Claude Code, then this page fills in.</span>`}</p>
    <div id="progress-panel"></div>
    <div class="tabs">${tabs.map(([k, l]) =>
      `<button class="tab ${state.tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
    <div id="tab-body"></div>`;

  $("#btn-update").onclick = async () => {
    await api(`/api/companies/${state.slug}/run-update`, { method: "POST" });
    await refreshSidebar(); await renderDetail();
  };
  el.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => { state.tab = t.dataset.tab; renderTab(data); };
  });
  renderTab(data);
}

function renderTab(data) {
  const body = $("#tab-body");
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === state.tab));
  if (state.tab === "brief") return renderBrief(body, data.brief);
  if (state.tab === "questions") return renderQuestions(body);
  if (state.tab === "interview") return renderInterview(body, data);
  if (state.tab === "stories") return renderStoriesTab(body);
  if (state.tab === "history") return renderHistory(body, data.sessions);
  if (state.tab === "prep") return renderPrepPack(body);
}

// ---- Brief ---------------------------------------------------------------
function renderBrief(body, brief) {
  if (!brief) {
    body.innerHTML = `<p class="muted">No brief yet. Once the discovery job is
      processed in Claude Code, the company brief — official pages, interview
      format, recent 6-month news (each with a clickable source), and prep
      sources — appears here.</p>`;
    return;
  }
  let html = "";
  if (brief.prep_sources && brief.prep_sources.length) {
    html += `<div class="card"><h3>Prep sources</h3>`;
    for (const s of brief.prep_sources)
      html += `<div class="src">${s.type ? `<span class="cat">${esc(s.type)}</span> ` : ""}
        <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></div>`;
    html += `</div>`;
  }
  html += `<h2>Recent achievements &amp; news (trailing 6 months)</h2>`;
  const items = brief.recent_items || [];
  if (!items.length) html += `<p class="muted">No items recorded.</p>`;
  for (const it of items) {
    html += `<div class="card">
      <span class="cat">${esc(it.category || "News")}</span>
      <h3>${esc(it.title || (it.summary || "").slice(0, 80) || "Item")}</h3>
      <p>${esc(it.summary || "")}</p>
      <div class="src">🔗 <a href="${esc(it.source_url)}" target="_blank" rel="noopener">${esc(it.source_url)}</a></div>
      <div class="fetched">fetched ${fmt(it.fetched_at)}</div>
    </div>`;
  }
  body.innerHTML = html;
}

// ---- Questions -----------------------------------------------------------
async function renderQuestions(body) {
  body.innerHTML = `<p class="muted">Loading…</p>`;
  const q = await api(`/api/companies/${state.slug}/questions`);
  let html = `
    <div class="row-actions">
      <button class="secondary" id="btn-find-q">Find reported questions</button>
      <button class="secondary" id="btn-predict-q">Generate predicted questions</button>
    </div>
    <p class="hint">Reported = from public interview-experience sources (labeled,
      unverified). Predicted = generated from the company's recent news, with a
      likelihood + rationale.</p>`;
  const rounds = q.rounds || {};
  const keys = Object.keys(rounds);
  if (!keys.length) {
    html += `<p class="muted">No questions yet. Use the buttons above — they queue
      a job you process in Claude Code.</p>`;
  }
  for (const rk of keys) {
    html += `<h2>${esc(rk.replace(/_/g, " "))}</h2>`;
    for (const item of rounds[rk]) {
      const gen = item.type === "generated";
      html += `<div class="card">
        <span class="cat ${gen ? "gen" : "rep"}">${gen ? "predicted" : "reported"}</span>
        ${item.likelihood ? `<span class="pill lk-${esc(item.likelihood)}">${esc(item.likelihood)}</span>` : ""}
        <p class="q">${esc(item.question)}</p>
        ${item.rationale ? `<p class="hint">Why: ${esc(item.rationale)}</p>` : ""}
        ${item.source_url ? `<div class="src">🔗 <a href="${esc(item.source_url)}" target="_blank" rel="noopener">${esc(item.source || item.source_url)}</a></div>` : ""}
      </div>`;
    }
  }
  body.innerHTML = html;
  $("#btn-find-q").onclick = async () => {
    await api(`/api/companies/${state.slug}/questions/refresh`, { method: "POST" });
    flash("Queued: find reported questions — process in Claude Code."); refreshSidebar();
  };
  $("#btn-predict-q").onclick = async () => {
    await api(`/api/companies/${state.slug}/predict`, { method: "POST" });
    flash("Queued: generate predicted questions — process in Claude Code."); refreshSidebar();
  };
}

// ---- Mock Interview (setup + live) --------------------------------------
async function renderInterview(body, data) {
  if (!data.brief) {
    body.innerHTML = `<p class="muted">Research this company first — the mock
      interviewer uses the brief as its grounding.</p>`;
    return;
  }
  if (state.session) { renderLiveSession(body); return; }

  const resume = await api(`/api/companies/${state.slug}/resume`);
  const hasGap = resume && resume.gap_analysis;
  const voiceSupported = "speechSynthesis" in window ||
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  body.innerHTML = `
    <div class="card setup">
      <h3>Set up your mock interview</h3>
      <div class="cfg-grid">
        <label>Interviewer persona
          <select id="cfg-persona">
            <option value="warm">Warm — encouraging</option>
            <option value="neutral" selected>Neutral — professional</option>
            <option value="pressure">High-pressure — probing</option>
          </select></label>
        <label>Difficulty
          <select id="cfg-difficulty">
            <option value="easy">Easy</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
          </select></label>
      </div>
      <fieldset class="rounds">
        <legend>Rounds</legend>
        ${["mixed", "recruiter", "case", "behavioral", "technical", "hr_fit", "bar_raiser"]
          .map((r, i) => `<label class="chk"><input type="checkbox" value="${r}" ${r === "mixed" ? "checked" : ""}> ${r.replace(/_/g, " ")}</label>`).join("")}
      </fieldset>
      <label class="chk"><input type="checkbox" id="cfg-voice"> 🎙️ Voice mode (speak answers, hear questions)</label>
      <label class="chk ${hasGap ? "" : "disabled"}">
        <input type="checkbox" id="cfg-gap" ${hasGap ? "" : "disabled"}> Target my resume gaps
        ${hasGap ? "" : '<span class="hint">(add a resume/JD below first)</span>'}</label>
      <button id="btn-start">Start interview</button>
      ${voiceSupported ? "" : '<p class="hint">Voice not supported in this browser — typing only.</p>'}
    </div>

    <details class="card">
      <summary>Resume &amp; job description (optional — powers gap-targeting)</summary>
      <textarea id="resume-text" placeholder="Paste your resume text…">${esc((resume && resume.resume_text) || "")}</textarea>
      <textarea id="jd-text" placeholder="Paste the job description…">${esc((resume && resume.jd_text) || "")}</textarea>
      <button class="secondary" id="btn-save-resume">Save &amp; analyse gaps</button>
      ${hasGap ? renderGap(resume.gap_analysis) : ""}
    </details>`;

  $("#btn-start").onclick = startInterview;
  $("#btn-save-resume").onclick = async () => {
    await api(`/api/companies/${state.slug}/resume`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_text: $("#resume-text").value, jd_text: $("#jd-text").value }),
    });
    flash("Saved. Gap analysis queued — process in Claude Code."); refreshSidebar();
  };
}

function renderGap(g) {
  let h = `<div class="gap"><h4>Gap analysis</h4>`;
  if (g.missing_from_resume) h += `<p><b>Missing/thin:</b> ${g.missing_from_resume.map(esc).join(", ")}</p>`;
  if (g.gap_questions) h += `<p><b>${g.gap_questions.length} gap-probing questions</b> ready for the mock.</p>`;
  return h + `</div>`;
}

async function startInterview() {
  const persona = $("#cfg-persona").value;
  const difficulty = $("#cfg-difficulty").value;
  const rounds = [...document.querySelectorAll('.rounds input:checked')].map((c) => c.value);
  state.voiceOn = $("#cfg-voice").checked;
  const use_gap = $("#cfg-gap").checked;
  const r = await api(`/api/companies/${state.slug}/interview/start`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona, difficulty, rounds: rounds.length ? rounds : ["mixed"], use_gap }),
  });
  state.session = r.session_id;
  await refreshSidebar();
  renderLiveSession($("#tab-body"));
}

function renderLiveSession(body) {
  body.innerHTML = `
    <div class="live-head">
      <span class="pill">${state.voiceOn ? "🎙️ voice" : "⌨️ text"}</span>
      <button class="secondary tiny" id="btn-voice-toggle">${state.voiceOn ? "Voice on" : "Voice off"}</button>
    </div>
    <div id="chat"></div>
    <div id="turn-area"></div>`;
  $("#btn-voice-toggle").onclick = () => {
    state.voiceOn = !state.voiceOn;
    $("#btn-voice-toggle").textContent = state.voiceOn ? "Voice on" : "Voice off";
    $(".live-head .pill").textContent = state.voiceOn ? "🎙️ voice" : "⌨️ text";
  };
  drawSession(true);
  startPoll();
}

let _lastSpokenTurn = -1;
async function drawSession(first) {
  const s = await api(`/api/companies/${state.slug}/interview/${state.session}`);
  const chat = $("#chat"); if (!chat) return;
  chat.innerHTML = "";
  s.turns.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = `bubble ${t.role}`;
    let extra = "";
    if (t.analytics) {
      const a = t.analytics;
      extra = `<div class="metrics">${a.word_count} words · ${a.filler_count} fillers` +
        (a.wpm ? ` · ${a.wpm} wpm` : "") + `</div>`;
    }
    div.innerHTML = `<div class="who">${t.role}</div>${esc(t.text)}${extra}`;
    chat.appendChild(div);
  });
  chat.scrollTop = chat.scrollHeight;

  // speak the latest interviewer turn if voice is on
  if (state.voiceOn && s.turns.length) {
    const last = s.turns[s.turns.length - 1];
    if (last.role === "interviewer" && (s.turns.length - 1) > _lastSpokenTurn) {
      _lastSpokenTurn = s.turns.length - 1;
      speak(last.text);
    }
  }

  const area = $("#turn-area"); if (!area) return;
  if (s.status === "ended" && s.feedback) { stopPoll(); area.innerHTML = renderFeedback(s.feedback); wireFeedback(); return; }
  if (s.status === "stopped") { stopPoll(); area.innerHTML = `<p class="waiting">Session stopped.</p>`; return; }
  if (s.awaiting === "interviewer") {
    area.innerHTML = `<p class="waiting">⏳ Interviewer is thinking — process the
      <code>interview_turn</code> job in Claude Code…</p>`;
    return;
  }
  // awaiting candidate
  area.innerHTML = `
    <div id="answer-row">
      <textarea id="answer-input" placeholder="Type your answer…"></textarea>
    </div>
    <div class="answer-controls">
      <button id="btn-send">Send answer</button>
      ${sttSupported() ? `<button class="secondary" id="btn-mic">🎤 Hold to speak</button>` : ""}
      <button class="secondary" id="btn-end">End &amp; get feedback</button>
      <span id="mic-status" class="hint"></span>
    </div>`;
  if (first) state.answerStart = Date.now();
  $("#btn-send").onclick = sendAnswer;
  $("#btn-end").onclick = endInterview;
  if (sttSupported()) wireMic();
}

async function sendAnswer() {
  const ta = $("#answer-input");
  const text = ta.value.trim();
  if (!text) { flash("Type or speak an answer first."); return; }
  ta.disabled = true;
  const durSec = state.answerStart ? (Date.now() - state.answerStart) / 1000 : null;
  const analytics = computeAnalytics(text, durSec);
  await api(`/api/companies/${state.slug}/interview/${state.session}/answer`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, analytics }),
  });
  state.answerStart = Date.now();
  await refreshSidebar();
  await drawSession();
}

async function endInterview() {
  await api(`/api/companies/${state.slug}/interview/${state.session}/end`, { method: "POST" });
  await refreshSidebar(); await drawSession();
}

function renderFeedback(fb) {
  let html = `<div class="card"><h3>Session feedback</h3>`;
  if (fb.rubric) {
    html += `<div class="rubric">`;
    for (const [dim, val] of Object.entries(fb.rubric))
      html += `<div class="dim">${esc(dim)}</div><div class="score">${esc(String(val))}/5</div>`;
    html += `</div>`;
  }
  if (fb.strengths) html += `<p><b>Strong:</b> ${esc(fb.strengths)}</p>`;
  if (fb.improvements) html += `<p><b>Work on:</b> ${esc(fb.improvements)}</p>`;
  if (fb.star_note) html += `<p><b>STAR:</b> ${esc(fb.star_note)}</p>`;
  html += `</div><button id="btn-restart" class="secondary">Start another</button>`;
  return html;
}
function wireFeedback() {
  const b = $("#btn-restart");
  if (b) b.onclick = () => { state.session = null; _lastSpokenTurn = -1; renderDetail(); };
}

// ---- Delivery analytics (client-side, It.3) ------------------------------
function computeAnalytics(text, durationSec) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lower = " " + text.toLowerCase() + " ";
  const fillers = ["um", "uh", "er", "ah", "like", "you know", "basically",
    "actually", "literally", "sort of", "kind of", "i mean", "right"];
  let fillerCount = 0; const breakdown = {};
  for (const f of fillers) {
    const re = new RegExp("(?:^|\\W)" + f.replace(/ /g, "\\s+") + "(?=\\W|$)", "gi");
    const n = (lower.match(re) || []).length;
    if (n) { fillerCount += n; breakdown[f] = n; }
  }
  const wc = words.length;
  return {
    word_count: wc,
    filler_count: fillerCount,
    filler_rate: wc ? Math.round((fillerCount / wc) * 1000) / 10 : 0,
    wpm: durationSec && durationSec > 2 ? Math.round(wc / (durationSec / 60)) : null,
    duration_sec: durationSec ? Math.round(durationSec) : null,
    fillers: breakdown,
  };
}

// ---- Voice: TTS + STT ----------------------------------------------------
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}
function sttSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
let _recog = null;
function wireMic() {
  const btn = $("#btn-mic"); const status = $("#mic-status"); const ta = $("#answer-input");
  if (!btn) return;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const start = () => {
    try {
      _recog = new Rec();
      _recog.continuous = true; _recog.interimResults = true; _recog.lang = "en-US";
      state.answerStart = Date.now();
      let base = ta.value ? ta.value + " " : "";
      _recog.onresult = (e) => {
        let interim = "", final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript + " "; else interim += r[0].transcript;
        }
        ta.value = base + final + interim;
      };
      _recog.onerror = (e) => { status.textContent = "mic error: " + e.error; };
      _recog.start();
      status.textContent = "listening…"; btn.classList.add("recording");
    } catch (err) { status.textContent = "mic unavailable"; }
  };
  const stop = () => {
    if (_recog) { try { _recog.stop(); } catch (_) {} _recog = null; }
    status.textContent = ""; btn.classList.remove("recording");
  };
  btn.onmousedown = start; btn.onmouseup = stop; btn.onmouseleave = stop;
  btn.ontouchstart = (e) => { e.preventDefault(); start(); };
  btn.ontouchend = (e) => { e.preventDefault(); stop(); };
}

// ---- Story Bank (global) -------------------------------------------------
async function renderStoriesTab(body) {
  const [{ stories }, coverage] = await Promise.all([
    api("/api/story-bank"),
    api(`/api/companies/${state.slug}/story-coverage`),
  ]);
  let html = "";
  if (coverage && (coverage.needed || []).length) {
    html += `<div class="card"><h3>Coverage for this company</h3>`;
    if ((coverage.have || []).length)
      html += `<p><b>Covered:</b> ${coverage.have.map(esc).join(", ")}</p>`;
    if ((coverage.missing || []).length)
      html += `<p class="warn-text"><b>No story yet:</b> ${coverage.missing.map(esc).join(", ")}</p>`;
    html += `</div>`;
  }
  html += storyFormHtml();
  html += `<h2>Your stories (${(stories || []).length})</h2>`;
  for (const s of (stories || [])) {
    html += `<div class="card story">
      <div class="story-head"><h3>${esc(s.title)}</h3>
        <button class="secondary tiny" data-del="${esc(s.id)}">Delete</button></div>
      ${(s.competencies || []).length ? `<div>${s.competencies.map((c) => `<span class="cat">${esc(c)}</span>`).join(" ")}</div>` : ""}
      <div class="star"><b>S</b> ${esc(s.situation)}<br><b>T</b> ${esc(s.task)}<br>
        <b>A</b> ${esc(s.action)}<br><b>R</b> ${esc(s.result)}</div>
    </div>`;
  }
  body.innerHTML = html;
  $("#btn-add-story").onclick = addStory;
  body.querySelectorAll("button[data-del]").forEach((b) =>
    b.onclick = async () => {
      await api(`/api/story-bank/${b.dataset.del}/delete`, { method: "POST" });
      renderStoriesTab(body);
    });
}
function storyFormHtml() {
  return `<details class="card"><summary>➕ Add a STAR story</summary>
    <input id="s-title" placeholder="Title (e.g. Turned around a failing project)">
    <input id="s-comp" placeholder="Competencies, comma-separated (leadership, conflict, ownership)">
    <textarea id="s-s" placeholder="Situation"></textarea>
    <textarea id="s-t" placeholder="Task"></textarea>
    <textarea id="s-a" placeholder="Action"></textarea>
    <textarea id="s-r" placeholder="Result (quantify!)"></textarea>
    <button id="btn-add-story">Save story</button></details>`;
}
async function addStory() {
  const title = $("#s-title").value.trim();
  if (!title) { flash("Story needs a title."); return; }
  await api("/api/story-bank", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      competencies: $("#s-comp").value.split(",").map((x) => x.trim()).filter(Boolean),
      situation: $("#s-s").value, task: $("#s-t").value,
      action: $("#s-a").value, result: $("#s-r").value,
    }),
  });
  renderStoriesTab($("#tab-body"));
}

// ---- History + delivery trends ------------------------------------------
async function renderHistory(body, sessions) {
  let html = "";
  const { points } = await api(`/api/companies/${state.slug}/delivery-trends`);
  if (points && points.length) {
    html += `<div class="card"><h3>Delivery trends</h3>`;
    html += miniChart("Words per minute", points.map((p) => p.avg_wpm), points);
    html += miniChart("Filler rate (%)", points.map((p) => p.avg_filler_rate), points, true);
    html += `</div>`;
  }
  if (!sessions.length) { body.innerHTML = html + `<p class="muted">No sessions yet.</p>`; return; }
  for (const s of sessions) {
    html += `<div class="card">
      <h3>${fmt(s.started_at)}</h3>
      <p class="muted">${s.turns} turns · ${s.status}${s.has_feedback ? " · feedback ✓" : ""}</p>
      <button class="secondary" data-sid="${esc(s.session_id)}">Open</button>
    </div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll("button[data-sid]").forEach((b) =>
    b.onclick = () => { state.session = b.dataset.sid; state.tab = "interview"; renderDetail(); });
}
function miniChart(label, values, points, lowerBetter) {
  const nums = values.filter((v) => v != null);
  if (!nums.length) return "";
  const max = Math.max(...nums, 1);
  let bars = "";
  values.forEach((v, i) => {
    const h = v == null ? 0 : Math.round((v / max) * 60);
    bars += `<div class="bar-wrap" title="${fmt(points[i].started_at)}: ${v ?? "—"}">
      <div class="bar" style="height:${h}px"></div><span>${v ?? "—"}</span></div>`;
  });
  return `<div class="mini"><div class="mini-label">${label}</div><div class="bars">${bars}</div></div>`;
}

// ---- Prep Pack -----------------------------------------------------------
async function renderPrepPack(body) {
  const p = await api(`/api/companies/${state.slug}/prep-pack`);
  let html = `<div class="row-actions"><button id="btn-print">🖨️ Print / Save as PDF</button></div>
    <div id="prep-pack">
      <h2>${esc(p.company)}${p.role ? " — " + esc(p.role) : ""}</h2>
      <p class="muted">Interview format: ${esc(p.interview_format || "unknown")} ·
        generated ${fmt(p.generated_at)}</p>`;

  html += `<h3>Top recent news to reference</h3>`;
  html += (p.top_news || []).length
    ? "<ul>" + p.top_news.map((n) => `<li>${esc(n.summary || n.title || "")}
        ${n.source_url ? `<a href="${esc(n.source_url)}" target="_blank">↗</a>` : ""}</li>`).join("") + "</ul>"
    : `<p class="muted">None yet.</p>`;

  html += `<h3>Top likely questions</h3>`;
  html += (p.top_questions || []).length
    ? "<ol>" + p.top_questions.map((q) => `<li>${esc(q.question)}
        ${q.likelihood ? `<span class="pill lk-${esc(q.likelihood)}">${esc(q.likelihood)}</span>` : ""}</li>`).join("") + "</ol>"
    : `<p class="muted">None yet — generate predicted questions.</p>`;

  html += `<h3>Your stories (${(p.stories || []).length})</h3>`;
  html += (p.stories || []).length
    ? "<ul>" + p.stories.map((s) => `<li><b>${esc(s.title)}</b> — ${(s.competencies || []).map(esc).join(", ")}</li>`).join("") + "</ul>"
    : `<p class="muted">No stories in your bank.</p>`;
  if ((p.story_gaps || []).length)
    html += `<p class="warn-text">Competencies with no story: ${p.story_gaps.map(esc).join(", ")}</p>`;

  if ((p.weak_spots || []).length) {
    html += `<h3>Focus areas (weak in past sessions)</h3><ul>` +
      p.weak_spots.map((w) => `<li>${esc(w.dimension)} — avg ${w.avg}/5 over ${w.n}</li>`).join("") + `</ul>`;
  }
  html += `</div>`;
  body.innerHTML = html;
  $("#btn-print").onclick = () => window.print();
}

// ==========================================================================
// Story Bank top-level view (header button)
// ==========================================================================
$("#story-bank-btn").onclick = async () => {
  stopPoll();
  state.view = "storybank"; state.slug = null; state.session = null;
  await refreshSidebar();
  $("#empty-state").hidden = true;
  const el = $("#company-detail"); el.hidden = false;
  el.innerHTML = `<div class="detail-head"><h1>📚 Story Bank</h1></div>
    <p class="subline">Reusable STAR stories, shared across every company.</p>
    <div id="tab-body"></div>`;
  const { stories } = await api("/api/story-bank");
  let html = storyFormHtml() + `<h2>Your stories (${(stories || []).length})</h2>`;
  for (const s of (stories || [])) {
    html += `<div class="card story">
      <div class="story-head"><h3>${esc(s.title)}</h3>
        <button class="secondary tiny" data-del="${esc(s.id)}">Delete</button></div>
      ${(s.competencies || []).length ? `<div>${s.competencies.map((c) => `<span class="cat">${esc(c)}</span>`).join(" ")}</div>` : ""}
      <div class="star"><b>S</b> ${esc(s.situation)}<br><b>T</b> ${esc(s.task)}<br>
        <b>A</b> ${esc(s.action)}<br><b>R</b> ${esc(s.result)}</div></div>`;
  }
  $("#tab-body").innerHTML = html;
  $("#btn-add-story").onclick = async () => { await addStory(); $("#story-bank-btn").click(); };
  $("#tab-body").querySelectorAll("button[data-del]").forEach((b) =>
    b.onclick = async () => { await api(`/api/story-bank/${b.dataset.del}/delete`, { method: "POST" }); $("#story-bank-btn").click(); });
};

// ==========================================================================
// Polling + kill switch + helpers
// ==========================================================================
function startPoll() {
  stopPoll();
  state.poll = setInterval(async () => {
    await refreshSidebar();
    if (state.tab === "interview" && state.session) await drawSession();
  }, 3000);
}
function stopPoll() { if (state.poll) { clearInterval(state.poll); state.poll = null; } }

function stopAllTimers() {
  stopPoll();
  if (state.bootTimer) { clearInterval(state.bootTimer); state.bootTimer = null; }
}
function showStoppedOverlay(info) {
  let ov = document.getElementById("stopped-overlay");
  if (!ov) { ov = document.createElement("div"); ov.id = "stopped-overlay"; document.body.appendChild(ov); }
  const c = (info && typeof info.cancelled_jobs === "number") ? info.cancelled_jobs : 0;
  const s = (info && typeof info.stopped_sessions === "number") ? info.stopped_sessions : 0;
  ov.innerHTML = `<div class="stopped-card"><div class="stopped-icon">⛔</div>
    <h2>System stopped</h2><p>All activity has been halted.</p>
    <ul><li>${c} queued job${c === 1 ? "" : "s"} cancelled</li>
      <li>${s} active interview${s === 1 ? "" : "s"} stopped</li>
      <li>Dashboard polling stopped</li><li>Local server shutting down</li></ul>
    <p class="restart">To use it again, restart in your terminal:<br><code>python app/server.py</code></p>
    <p class="note">Nothing was deleted — cancelled jobs are kept in <code>data/jobs/cancelled/</code>.</p></div>`;
  ov.hidden = false;
}
$("#kill-switch").onclick = async () => {
  if (!confirm("KILL SWITCH\n\nThis will:\n  • cancel all queued jobs\n  • stop any active interview\n  • stop the dashboard polling\n  • shut down the local server\n\nProceed?")) return;
  let info = {};
  try { info = await api("/api/kill", { method: "POST" }); } catch (_) {}
  stopAllTimers(); showStoppedOverlay(info);
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// boot
refreshSidebar();
state.bootTimer = setInterval(refreshSidebar, 5000);
