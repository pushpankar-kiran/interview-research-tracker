# Interview Research Tracker — Iteration 1

A local, private interview-prep tool. Researches a company (grounded in real,
sourced web data), then lets you run a text mock interview grounded in that
research and get rubric-scored feedback. Runs on your Claude subscription — no
hosting, no API billing, nothing running in the background.

## Features (all iterations built)

**Research & tracking**
- Add company by name/URL + optional role; file-drop job queue trigger
- Discovery → grounded `brief.json` (official pages, format, 6-month news, sources)
- **No-dummy-data rule enforced**: every fact needs a source URL + fetch time
- Run Update, Past & Predicted Questions (reported vs generated, with likelihood)

**Mock interview**
- Adaptive text interviewer grounded in the brief
- **Voice mode**: browser TTS (spoken questions) + push-to-talk STT (with typing fallback)
- **Delivery analytics** (client-side): words, filler-word rate, WPM per answer + trends
- Interviewer **persona** (warm/neutral/pressure), **difficulty**, **multi-round loop**
- Rubric scoring + STAR feedback; weakness-driven focus across sessions
- Session history saved locally

**Personalization**
- Resume/JD ingestion → gap analysis → gap-probing questions
- **STAR story bank** (global, reusable) with per-company competency coverage
- **Prep-pack export** (one-page, Print/Save-as-PDF): news, top questions, stories, weak spots

**Safety & ops**
- Kill switch, rate limiting, errors surfaced (never swallowed)

Job types processed by Claude in your session: `discover`, `update`, `questions`,
`predict`, `resume_gap`, `interview_turn`, `feedback`. See `prompts/` and
`PROCESSING_GUIDE.md`. Client-side features (voice, delivery analytics, prep-pack,
story bank CRUD) run entirely in the browser — no job needed.

## Requirements
Just **Python 3** (standard library only — nothing to install, no database).
```bash
python --version
```

## Kill switch
The red **⛔ Kill switch** in the dashboard header stops everything at once:
- cancels all queued jobs (moved to `data/jobs/cancelled/`, not deleted),
- stops any active interview session (marked `stopped`),
- halts the dashboard's polling,
- shuts the local server down cleanly.

It is **non-destructive** — no company data, briefs, or transcripts are removed.
To use the tool again after a kill, restart the server: `python app/server.py`.

## Rate limiting
The server applies a per-client sliding-window rate limit so a runaway polling
loop or a stuck interview can't flood the job queue. Two buckets:
- **read** (GET/static/polling): 200 requests / 10s
- **write** (POSTs that enqueue jobs): 20 requests / 10s

Over-limit requests get HTTP `429` with a `Retry-After` header; the dashboard
shows a brief "slow down" banner and keeps working. Tune via env vars if needed:
`IRT_RATE_WINDOW` (seconds), `IRT_RATE_READ`, `IRT_RATE_WRITE`, `IRT_PORT`.

## Run
```bash
python app/server.py
```
Open http://localhost:8756

Then process the queue in your Claude Code session — see
[`PROCESSING_GUIDE.md`](PROCESSING_GUIDE.md).

## Layout
```
app/
├── server.py            # local dashboard server (stdlib only)
├── lib/storage.py       # JSON storage, atomic writes, no-dummy-data check
├── web/                 # dashboard UI (html/css/js)
├── prompts/             # discovery.md + interview.md (what Claude follows)
├── PROCESSING_GUIDE.md  # how the queue gets processed
└── data/
    ├── companies/<slug>/{meta.json, brief.json, sessions/*.json}
    ├── jobs/{pending,done}/
    └── errors.log
```

## The one acceptance test that matters
After researching a company, hand-verify 3 items in its brief against their
`source_url`. If all three match the live page, the no-dummy-data discipline is
working — which is the whole foundation.
