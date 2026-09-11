# Interview Research Tracker — Build Roadmap

Companion to `interview_research_tracker_spec.md`. Sequenced so every iteration ships something usable on its own, high-value features come early, and the risky plumbing is deferred until the core is proven.

**Guiding principle:** build a thin *vertical slice* first (one company, end to end), then widen. Never build a subsystem (dedup engine, voice, multi-round) before the thing it serves actually works.

---

## Iteration 1 — The Thin Vertical Slice (MVP)

**Goal:** One company, from "add it" to "practice a real interview and get scored feedback" — fully working, all data real and traceable. This is the smallest build that is genuinely useful and proves the two hardest questions: *does grounded real-data research work?* and *does the Claude-Code-as-runtime handoff feel okay?*

### Features in Iteration 1

| # | Feature | Spec ref | Why it's in the first cut |
|---|---------|----------|---------------------------|
| 1 | **Local dashboard** — plain HTML/CSS/JS served by Python's built-in server | Component A | You need a face to click. Kept minimal: add-company field + company list + one detail page. |
| 2 | **Add company by name or URL (+ optional role)** | FR-1, FR-2b | The single entry point. URL→identity resolution included. |
| 3 | **File-drop job queue** (`jobs/pending` → `jobs/done`) as the trigger contract | Component B | The honest solution to the runtime seam. Button writes a job file; you process it in your Claude Code session. No impossible "webpage silently spawns an authed agent." |
| 4 | **Discovery → one grounded `brief.json`** | FR-2, FR-2a, FR-3 | The research core. Official pages + interview format + trailing-6-month news + prep sources. |
| 5 | **The no-dummy-data rule, enforced** — every item needs `source_url` + `fetched_at` or it isn't saved | FR-6/7 (real-data discipline) | The most important guardrail. Built in from line one, not bolted on later. |
| 6 | **JSON storage, one folder per company** + atomic save (`os.replace`) | Component D | No install, human-readable, debuggable. |
| 7 | **Text-only mock interviewer** — adaptive follow-ups, grounded in the brief | FR-3a/b/c | The killer feature, in its safe (no-voice) form. Meets the fallback requirement already. |
| 8 | **Rubric scoring + STAR-structure feedback after each session** | FR-3e, FR-12 | This is what makes feedback feel professional vs. generic. Cheap to add now. |
| 9 | **Session history saved locally** | FR-3f | One JSON per session in the company folder. |
| 10 | **Errors surfaced, never swallowed** — `errors.log` + shown on dashboard | NFR-6 | Baked in early so failures are visible while you build. |

### Explicitly NOT in Iteration 1 (deferred on purpose)
- Voice input/output (FR-3d, FR-3d-i) → Iteration 3
- Delivery analytics — filler/pace (FR-10/11) → needs voice, Iteration 3
- Per-entry dedup / freshness diffing (NFR-7) → Iteration 2 (v1 just regenerates the brief wholesale)
- Scraped past-questions from Glassdoor/Reddit → Iteration 2 (v1 uses news-grounded *generated* questions)
- Resume/JD ingestion, story bank, predicted-question likelihood → Iteration 4
- Multi-round loop, personas, spaced repetition, prep-pack PDF → Iteration 5

### Definition of Done for Iteration 1
1. Add "Accenture" (or any company) → job file appears in `jobs/pending`.
2. Process the queue in a Claude Code session → `brief.json` written with real, clickable source URLs.
3. **Acceptance test:** hand-verify 3 brief items against their live source URLs — all 3 match. (Proves no dummy data.)
4. Start a text mock interview → it asks grounded questions, follows up on vague answers, and ends with a rubric score + STAR feedback.
5. Session is saved and re-openable. A forced error (unreachable site) shows on the dashboard, not swallowed.

---

## Iteration 2 — Make the Research Trustworthy & Repeatable

**Goal:** "Run Update" becomes meaningful; questions get richer; nothing gets re-stored twice.

| Feature | Spec ref |
|---------|----------|
| **Run Update** mode — re-check known sources, append only what's new | FR-4, FR-5 |
| **Content-hash dedup** — skip unchanged content on re-runs | NFR-7 |
| **Digest view** grouped by category, newest first | FR-7, FR-8 |
| **Past Interview Questions page** — news-grounded *generated* questions primary; scraped/search-snippet questions in a clearly-labeled "reported, unverified" section | FR-2c, FR-3b |
| **robots.txt compliance + per-run source cap** (code-enforced) | NFR-4/5, §3.4 guardrails |
| Add-company & Run-Update **directly from the dashboard** | FR-9 |

---

## Iteration 3 — Voice (the real-interview feel)

**Goal:** It feels like a spoken conversation. Built *half-duplex, push-to-talk* to sidestep the hard latency/barge-in problems.

| Feature | Spec ref |
|---------|----------|
| **Text-to-speech** — questions spoken aloud (browser `SpeechSynthesis`) | FR-3d-i |
| **Speech-to-text, push-to-talk** — "hold to answer", with always-visible "Type instead" fallback | FR-3d, NFR-10 |
| **Delivery analytics** — WPM/pace, filler-word rate, talk time, computed client-side | FR-10, NFR-11 |
| **Delivery scorecard + trend charts** across sessions | FR-11 |

---

## Iteration 4 — Personalization (the differentiators)

**Goal:** The interviewer knows *you* and *this company* deeply — the competitive moat.

| Feature | Spec ref |
|---------|----------|
| **Resume / JD ingestion → gap analysis → gap-probing questions** | FR-14 |
| **STAR story bank** — reusable tagged stories; flags competencies with no prepared story | FR-15 |
| **Predicted questions with likelihood + grounded rationale** tied to recent news | FR-16 |
| **Company values / competency-framework mapping** | FR-17 |
| **Model/benchmark answer on request** after each answer | FR-13 |

---

## Iteration 5 — Realism, Retention & Polish

**Goal:** Full best-in-class experience.

| Feature | Spec ref |
|---------|----------|
| **Full-loop multi-round simulation** (screen → case/technical → behavioral → bar-raiser) | FR-18 |
| **Interviewer personas / pressure & difficulty settings** | FR-19 |
| **Weakness-driven spaced repetition** | FR-20 |
| **Pre-interview prep-pack export (one-page PDF)** | FR-21 |

---

## Sequencing rationale (why this order)

1. **Value-first:** the mock interviewer (the differentiated feature) appears in Iteration 1, not last.
2. **Risk-first:** the two scariest unknowns — real-data grounding and the runtime handoff — are both proven in Iteration 1, before you've invested in anything else.
3. **Deferred plumbing:** dedup/freshness/robots machinery (lots of effort, low visible payoff) waits until there's real research worth maintaining.
4. **Voice isolated:** the fiddliest UX (voice) is its own iteration, so it can't block the core logic from shipping.
5. **Moat later, but not too late:** personalization (resume/story-bank/predictions) lands in Iteration 4 — after the loop works, before final polish.

---

## Tech stack for Iteration 1 (no installs beyond Python)
- **Dashboard:** static HTML/CSS/vanilla JS
- **Server:** Python `http.server` (built-in)
- **Storage:** JSON files, one folder per company, atomic `os.replace` writes
- **Trigger:** file-drop queue (`data/jobs/pending` → `data/jobs/done`)
- **Agent:** Claude Code (interactive, your subscription) processes the queue, does WebSearch/WebFetch, writes briefs
- **Scoring/interview:** the agent, prompted with the rubric + the company brief as grounding
