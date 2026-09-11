# Interview Research Tracker — Requirements & System Design

## 1. Purpose

A personal tool that researches any company you're interviewing with, tracks interview-relevant information over time, and presents it in a simple local dashboard — triggered manually, running on your Claude subscription, with no hosting cost and no unattended/scheduled execution.

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | The system must accept either a company name or a company URL as input, with no hardcoded company-specific logic. If given a URL, the system must resolve it to the company's identity (name, official domain) before proceeding, rather than treating the URL itself as the source profile. |
| FR-2 | On adding a new company, the system must research and determine: (a) the company's official newsroom/careers/investor-relations pages, (b) its likely interview format (case-based, technical, behavioral-heavy, etc.), inferred from public sources, (c) 3–5 credible third-party interview-prep sources, and (d) whether the company itself hosts a dedicated candidate-resource or learning page (e.g. "interview prep," "candidate resources," "hiring FAQ," recruiter blog) — if found, this counts as a first-party source and should be prioritized above third-party ones. |
| FR-2a | For each tracked company, the system must identify and summarize, within the past 6 months: notable research or product achievements, acquisitions or mergers, new client wins/onboardings, and new project or product announcements. This is a one-time backfill on discovery, then kept current by the regular update runs (FR-5–FR-7) as new items appear. |
| FR-2b | The system must accept an optional job role/title alongside the company (e.g. "Strategy Consulting Analyst"). When provided, discovery must search for past interview questions reported for that company + role combination, drawing from publicly indexed content on interview-experience sites (e.g. Glassdoor, AmbitionBox) and public social media discussion (e.g. public Reddit threads, LinkedIn posts) — via search-engine results only, not by logging into or scraping behind any platform's login wall. |
| FR-2c | The system must maintain a dedicated "Past Interview Questions" page, separate from the general digest, listing discovered questions grouped by round type (e.g. case, behavioral, HR/fit, technical) with the source noted for each. Update runs should check for newly surfaced questions and append rather than duplicate. |
| FR-3a | The system must offer a dedicated **AI Mock Interviewer** page per company (and role, if set) that conducts a realistic, adaptive interview session using the company's stored data (source profile, recent achievements/deals, discovered past questions) as its knowledge base. |
| FR-3b | The mock interviewer must ask a mix of question types appropriate to the company's inferred format (e.g. case, behavioral, HR/fit) rather than a fixed script, drawing primarily from the "Past Interview Questions" page where available and generating plausible, on-theme questions elsewhere. |
| FR-3c | The mock interviewer must be adaptive within a session — asking natural follow-up questions based on the user's actual answer (e.g. probing a vague STAR answer for specifics), not just reading a static list top to bottom. |
| FR-3d | The user must be able to answer by speaking (browser-based voice-to-text) as the primary input method, matching a real interview's format; typing must remain available as a fallback if voice input fails or isn't supported in the browser. |
| FR-3d-i | Questions from the mock interviewer should be spoken aloud (browser-based text-to-speech), not just displayed as text, so the session feels like a two-way spoken conversation rather than voice-in/text-out. |
| FR-3e | After each session, the system must give structured feedback: what was strong, what was vague or missing, and — for behavioral answers — whether the STAR structure (Situation, Task, Action, Result) was present. |
| FR-3f | Session history must be saved locally so the user can review past sessions and track improvement over time. |
| FR-3 | This discovered information ("source profile") must be stored per company so it does not need to be re-discovered on every run. |
| FR-4 | The system must let the user manually trigger an update ("Run Update" button) for one company or all tracked companies. |
| FR-5 | On each triggered run, the system must check each company's source profile for new or changed content. |
| FR-6 | The system must judge relevance of new content (interview-prep value) rather than storing everything indiscriminately. |
| FR-7 | Relevant findings must be summarized (not stored as raw scraped text) and written to local storage, tagged by company and category (Company News / Interview Format & Prep / Behavioral / Role-Specific / Recent Achievements & Deals / GLIM-Alumni or equivalent). "Recent Achievements & Deals" covers acquisitions, new client wins, product/project launches, and notable research or product achievements within the trailing 6 months. |
| FR-8 | A local dashboard must display the digest, filterable/switchable by company, most recent entries first. |
| FR-9 | The user must be able to add a new company from the dashboard itself. |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | **No hosting cost.** The system must run entirely on the user's local machine — no paid server, no cloud hosting. |
| NFR-2 | **No API key billing.** Execution must run under the user's existing Claude subscription (interactive Claude Code session), not a metered API key. |
| NFR-3 | **No unattended execution.** No cron jobs, schedulers, or background/headless triggers. Every run starts from an explicit user action (button press). |
| NFR-4 | **Source discipline.** The agent may only fetch pages it finds via search for the specific company being researched — no blind/recursive crawling of arbitrary sites. |
| NFR-4a | **No login-walled access.** For interview-question research (FR-2b), the system must rely only on publicly indexed/search-visible content. It must not attempt to log into, authenticate against, or scrape behind the login wall of any platform (LinkedIn, Glassdoor, private forums, etc.). If a platform blocks unauthenticated access entirely, it is skipped in favor of other public sources. |
| NFR-9 | **Realistic but honest scope.** The mock interviewer should feel like a real interview (adaptive follow-ups, natural phrasing, no visible "here is question 3 of 10" script-reading) but must not claim to be a certified or official predictor of interview outcomes — it's practice, not a guarantee. |
| NFR-10 | **Voice input is required, with a graceful fallback.** The mock interviewer must support answering by speaking (browser-based speech-to-text), not text-only. If speech-to-text fails or is unavailable in a given browser/environment, the system must fall back to text input rather than blocking the session entirely. |
| NFR-5 | **Respect robots.txt** on every fetched source. |
| NFR-6 | **No silent failures.** Errors (unreachable site, blocked fetch, parsing failure) must be logged and shown on the dashboard, not swallowed. |
| NFR-7 | **Deduplication.** Content already ingested and unchanged should be skipped on subsequent runs, not reprocessed. |
| NFR-8 | **Minimal manual effort per run.** Once triggered, the agent should autonomously decide what to search, what's relevant, and what to summarize — the user's only actions are: press button, read digest. |

### 2.3 Explicit Non-Goals

- Not a fully autonomous/self-scheduling system.
- Not a public-facing or multi-user website.
- Not a broad web crawler — deliberately scoped to a small, curated, per-company source set.
- Not optimized for cost at scale — this is a single-user, occasional-use tool.

---

## 3. System Design

### 3.1 High-Level Architecture

**In plain English first:**

Think of this as four things sitting on your own laptop, doing nothing until you act:

1. **A webpage you look at** — like a personal dashboard, but it only exists on your computer, not on the internet. This is where you type a company name, click "Run Update," and later read what it found.
2. **A "go" button's wiring** — a small helper that does nothing on its own except pass your click along, like a light switch. It doesn't think or decide anything.
3. **The researcher** — this is Claude Code itself, acting like a very fast, very thorough research assistant. When you click the button, it wakes up, goes and reads company websites and articles on the internet, decides what's actually useful for your interview prep, writes a short summary of what it found, and then goes back to sleep.
4. **A notebook** — a couple of plain files sitting on your computer where the researcher writes down what it learned, so it remembers it next time instead of starting from scratch.

Nothing runs by itself in the background. Nothing lives on the internet except the pages the researcher briefly visits to gather information. When you're not clicking anything, the whole system is completely inactive — like a word processor sitting closed on your desktop.

**The same flow, in technical terms:**

```
[Local Dashboard (HTML page + tiny local server)]
        |
        |  "Add Company" / "Run Update" (user click)
        v
[Trigger script] -- invokes -->  [Claude Code, interactive session, subscription auth]
        |
        |  Claude Code, given the task, uses:
        |    - Web search (source discovery, freshness checks)
        |    - Web fetch (targeted page reads)
        |    - Local file read/write (source profiles, digest entries)
        v
[Local storage: SQLite or JSON files]
   - companies.json        (source profiles per company)
   - digest.db / digest.json  (summarized, tagged entries)
        |
        v
[Dashboard reads storage and renders digest]
```

No external server, no database service, no scheduler process — everything except your browser and Claude Code sits idle until you press a button.

**A walkthrough of what actually happens when you use it, step by step:**

1. You open the dashboard in your browser (it looks like a simple local webpage — nothing fancy, no login).
2. You type "Accenture" (or paste a URL, or add a role like "Strategy Consulting Analyst") and click "Add Company."
3. Behind the scenes, this quietly tells Claude Code: "go figure out who this company is and where to look for useful information about them."
4. Claude Code does that research once — finding the company's official pages, guessing what kind of interview they run, finding a few good prep websites — and saves what it learned into your local notebook (item 4 above), so it never has to redo this basic groundwork again.
5. Now the company shows up on your dashboard with a "Run Update" button next to it.
6. Whenever you want fresh information (today, tomorrow, the night before your interview), you click "Run Update."
7. Claude Code wakes up again, revisits the sources it already knows about, checks what's new since last time, decides what's actually worth your attention, and writes a short summary into the notebook.
8. Your dashboard refreshes and shows you the new information, organized into sections (company news, recent deals/achievements, interview format tips, past interview questions, etc.).
9. Claude Code then goes fully idle again — using no resources, costing nothing — until you click something again.

### 3.2 Components

**A. Local Dashboard**
A single HTML page (plain HTML/CSS/JS, no framework needed) served by a minimal local script (e.g. Python's built-in HTTP server). Shows:
- A list of tracked companies with an "Add Company" field that accepts either a company name (e.g. "Accenture") or a URL (e.g. "accenture.com" or a careers-page link), plus an optional role/title field.
- Per-company digest view, grouped by category, newest first.
- A dedicated **"Past Interview Questions"** page per company (and per role, if multiple roles are tracked for the same company), grouped by round type (case / behavioral / HR-fit / technical), each question showing its source.
- A **"Mock Interview"** page per company/role, with a "Start Interview" button that begins a live Q&A session (type or speak your answers), and a history list of past sessions with their feedback.
- A "Run Update" button per company (and optionally "Run All").
- Basic error/status display (last run time, any failures).

**B. Trigger Script**
A small script that, when the button is pressed, invokes Claude Code with a fixed task prompt referencing the company and its current source profile (if any). This is the only "wiring" piece — it does not itself make judgment calls.

**C. The Agent (Claude Code, interactive)**
Does the actual thinking, in two modes depending on whether the company is new:

- *New company* → **Discovery mode**: if given a URL, first resolve it to the company's canonical name and official domain (a URL like a careers-page link or LinkedIn page still needs the actual company identified); then search for the company's official pages — including checking specifically for a dedicated candidate-resource/interview-prep/learning page hosted by the company itself — infer likely interview format from public information, identify 3–5 third-party prep sources, and write this as a source profile, flagging any first-party resource page as the highest-priority source. Discovery also performs a one-time backfill search for the company's notable activity in the trailing 6 months (acquisitions, new clients, product/project launches, research or product achievements) and writes these as initial "Recent Achievements & Deals" digest entries.
- *Existing company* → **Update mode**: check the stored source profile's pages for new/changed content, judge relevance, summarize what matters, append to the digest — including checking for any new acquisitions, client wins, or product/project announcements since the last run, so the "Recent Achievements & Deals" category stays current on a rolling 6-month basis.

**D. Local Storage**
- `companies.json` — one entry per company: official pages, inferred interview format, prep source list, last-checked timestamps.
- `digest` store — summarized entries with company tag, category tag, date, source link, and a content hash (for dedup).
- `interview_sessions` store — past mock interview transcripts and feedback, tagged by company/role and date.

**E. AI Mock Interviewer**
A separate mode of the same underlying agent (Claude Code, interactive, your subscription), triggered from its own dashboard page rather than the "Run Update" button. In plain terms: it reads everything the researcher (component C) has already gathered about the company — the past questions it found, the company's recent news, its likely interview style — and uses that as its "briefing notes" to role-play a realistic interviewer. It asks you a question, listens to (or reads) your answer, asks a natural follow-up if your answer was vague, and moves on — the same way a real interviewer would, rather than just reading down a fixed list. At the end, it gives you feedback on how you did, and saves the transcript so you can look back on it later.

### 3.3 Data Flow for a Single "Run Update" Click

1. User clicks "Run Update" for Company X.
2. Trigger script starts an interactive Claude Code session with a task prompt + Company X's stored profile (or "discover" instruction if none exists).
3. Claude Code searches/fetches as needed, respecting robots.txt and the source-list constraint.
4. Claude Code judges relevance and writes new digest entries (only for new/changed content) to local storage.
5. Claude Code exits; trigger script returns control to the dashboard.
6. Dashboard reloads and displays the updated digest.

### 3.4 Guardrails (enforced outside the agent's judgment, not by it)

- Fixed cap on number of sources checked per company per run.
- robots.txt compliance is code-enforced, not agent-decided.
- No fetch outside URLs the agent itself found via search in that same run (no arbitrary URL access).
- All errors surfaced to the dashboard, never silently discarded.

---

## 4. What Runs Where

| Piece | Runs on | Cost |
|---|---|---|
| Dashboard | Your machine (local server) | Free |
| Trigger script | Your machine | Free |
| Agent reasoning (search, judgment, summarization) | Claude Code, interactive, your subscription | Covered by subscription (you press the button) |
| Storage | Local file(s) on your machine | Free |

---

## 5. Open Decisions for Claude Code to Resolve During Build

These are intentionally left to implementation rather than specified here, per NFR-8:
- Exact local storage format (SQLite vs. JSON) — pick whichever is simpler to implement reliably.
- Exact local server approach for the dashboard.
- Prompt structure for discovery vs. update modes.
- Digest entry schema details (beyond the required tags above).

---

## 6. Best-in-Class Feature Set (Competitive Addendum)

These specs raise the tool from "useful personal tracker" to competitive with — and in key respects ahead of — commercial interview-prep tools (Yoodli, Final Round AI, Big Interview, Google Interview Warmup). They stay inside the original constraints: **local, subscription-authed, no recurring cost, no unattended execution.** Where a market feature conflicts with those constraints, it is explicitly excluded in §6.4.

### 6.1 Delivery & Communication Coaching (compete with Yoodli/Poised)

| ID | Requirement |
|----|-------------|
| FR-10 | The mock interviewer must compute **delivery analytics** for each spoken answer, entirely client-side from the browser speech transcript and timing: speaking pace (words per minute), filler-word count and rate ("um", "uh", "like", "you know", "basically"), total talk time, and answer length. No audio is uploaded or stored server-side. |
| FR-11 | The system must present a **per-answer and per-session delivery scorecard**, and chart these metrics across sessions so the user can see delivery improvement (e.g. filler rate trending down, pace stabilizing into a target band). |

### 6.2 Rubric Scoring & Benchmarking (compete with Big Interview / Final Round)

| ID | Requirement |
|----|-------------|
| FR-12 | Each answer must be scored on a **consistent rubric (1–5)** across fixed dimensions: Structure, Specificity, Relevance to the question, Impact/Quantification, and Communication. Scores must cite the specific evidence in the user's answer that justifies them (no un-anchored numbers). |
| FR-13 | After the user answers, the system must be able to show, on request, a **strong model/benchmark answer** grounded in the company's stored context, with a short note on what makes it strong (structure used, specifics cited, metrics quantified) — so the user learns the target, not just their gap. |

### 6.3 Personalization & Company-Intelligence Depth (the differentiators)

| ID | Requirement |
|----|-------------|
| FR-14 | The system must accept an optional **resume and/or job description**, run a gap analysis against the role, and generate questions that probe under-evidenced or weak areas (e.g. a leadership claim with no supporting story, a required skill absent from the resume). |
| FR-15 | The system must maintain a **STAR story bank**: the user's reusable experience stories, each tagged to competencies. The interviewer references these during sessions, and the system flags likely-required competencies for which the user has **no prepared story yet**. |
| FR-16 | Predicted/likely questions must carry a **likelihood indicator and a grounded rationale** tied to the trailing-6-month intelligence (e.g. "High — likely to probe integration risk given the recent acquisition of X [source]"). This is the tool's core edge over generic tools and must trace to a real source URL (per the no-dummy-data rule). |
| FR-17 | Questions and feedback must **map to the company's stated values or the role's competency framework** where discoverable (e.g. a firm's published leadership principles / core values), so behavioral answers are evaluated against what that specific company actually rewards. |

### 6.4 Realism & Retention (compete with human mocks / paid curricula)

| ID | Requirement |
|----|-------------|
| FR-18 | The system must support a **full-loop multi-round simulation** — chaining rounds appropriate to the company (e.g. recruiter screen → case/technical → behavioral → bar-raiser/partner) in one session, with each round carrying its own focus and difficulty. |
| FR-19 | The user must be able to select an **interviewer persona / pressure level** (e.g. warm, neutral, high-pressure/stress interview) and a difficulty setting; the interviewer's tone and follow-up aggressiveness adjust accordingly, without ever becoming abusive. |
| FR-20 | The system must use **weakness-driven spaced repetition**: question types and competencies the user scored low on must be preferentially resurfaced in later sessions until performance improves. |
| FR-21 | The user must be able to export a **pre-interview prep pack** (one-page PDF/printable view): company brief, top predicted questions with rationale, the user's matched STAR stories, and the last session's weak spots — a single sheet to review the night before. |

### 6.5 Additional Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-11 | **Privacy edge.** All delivery/speech analytics (FR-10) must be computed locally; raw audio must never leave the machine or be persisted. This is a deliberate advantage over cloud coaching tools. |
| NFR-12 | **Cost edge.** All added intelligence must run under the existing subscription with no new recurring fee, preserving a $0/month position against $30–250/month competitors. |
| NFR-13 | **Honest, calibrated scoring.** Rubric scores (FR-12) must be evidence-anchored and must not inflate. Feedback follows NFR-9: it is practice guidance, not a certified predictor of outcome. |

### 6.6 Deliberately Excluded (market features that conflict with scope/ethics)

- **Real-time, mid-answer answer-feeding** (as in some "AI copilot" tools) — this is effectively cheating in a live interview and is out of scope by design; the tool coaches *before/after*, it does not feed answers during a real interview.
- **Video / body-language / facial-expression analysis** — heavy, privacy-invasive, and outside the local/simple constraint.
- **Live coding-execution IDE** — scope creep unless/until technical-coding roles are explicitly targeted; deferred, not core.
- **Any certification or "guaranteed outcome" claim** — prohibited by NFR-9.

### 6.7 Competitive Positioning Summary

The combination that no single competitor offers: **Yoodli-style delivery coaching + Final-Round-style live company intelligence + a personal reusable story bank + full-loop realism — all local, private, and free under an existing subscription.** The moat is FR-16/FR-17: an interviewer grounded in *this company's real, current* activity, which generic tools structurally cannot match.
